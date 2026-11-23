/** Session open/resume, approval helpers, and generation-safe steering for the helper Hermes worker driver. */
import type { WorkerOutcome, WorkerStartRequest } from '../../worker-driver'
import { hermesToolsets } from './worker-hermes-env'
import { buildEditorMcpServers, type HermesModelOptions, resolveHermesModel } from './worker-hermes-model'
import { type HermesStreamState, mapHermesTranscript, seedHermesUsage } from './worker-hermes-protocol'
import { HermesRpcError, type HermesWorkerSocket } from './worker-hermes-socket'

export interface OpenedHermesSession {
  liveSessionId: string
  storedSessionId: string
  generation: number
  baselineMessages: number
  created: boolean
  fallbackNote?: string
}

export function approvePrompt(socket: HermesWorkerSocket, sessionId: string, promptId: string, generation: number) {
  void socket.request('approval.respond', { session_id: sessionId, execution_generation: generation, prompt_id: promptId, choice: 'once' }).catch(() => {})
}

function approveSnapshotPrompts(socket: HermesWorkerSocket, snap: Record<string, any>, fallbackSessionId?: string, fallbackGen = 0) {
  const sid = typeof snap.session_id === 'string' ? snap.session_id : fallbackSessionId
  if (!sid) return
  if (Array.isArray(snap.prompts)) {
    for (const p of snap.prompts) {
      if (p?.kind === 'approval' && typeof p.prompt_id === 'string') {
        approvePrompt(socket, sid, p.prompt_id, typeof p.execution_generation === 'number' ? p.execution_generation : fallbackGen)
      }
    }
  }
  if (Array.isArray(snap.open_requests)) {
    for (const r of snap.open_requests) {
      if (r?.method === 'approval' && typeof r.id === 'string' && r?.params?.session_id === sid) socket.respond(r.id, { choice: 'once' })
    }
  }
}

export async function openHermesSession(
  socket: HermesWorkerSocket,
  request: WorkerStartRequest,
  cwd: string,
  state: HermesStreamState
): Promise<{ ok: true; session: OpenedHermesSession } | { ok: false; error: string }> {
  const mcpServers = buildEditorMcpServers(request.mcp)
  if (!request.sessionId) {
    let modelChoice: { model?: string; provider?: string } = { model: request.model, ...(request.provider ? { provider: request.provider } : {}) }
    let fallbackNote: string | undefined
    try {
      const opts = (await socket.request('model.options', {}, 15_000)) as HermesModelOptions
      const resolved = resolveHermesModel(request.model, request.provider, opts)
      if (!resolved.ok) return { ok: false, error: resolved.error }
      modelChoice = { ...(resolved.model ? { model: resolved.model } : {}), ...(resolved.provider ? { provider: resolved.provider } : {}) }
      fallbackNote = resolved.fallbackNote
    } catch (error) {
      if (!(error instanceof HermesRpcError && error.reason === 'unknown_method')) throw error
    }
    const snap = await socket.request('session.create', {
      source: 'acp',
      hidden: true,
      yolo: true,
      ignore_rules: true,
      request_id: `worker-${request.runId}`,
      cwd,
      cwd_explicit: true,
      toolsets: hermesToolsets(request.capabilities),
      ...(modelChoice.model ? { model: modelChoice.model } : {}),
      ...(modelChoice.provider ? { provider: modelChoice.provider } : {}),
      ...(request.reasoningEffort ? { reasoning: request.reasoningEffort } : {}),
      ...(request.systemPrompt ? { client_env: { HERMES_EPHEMERAL_SYSTEM_PROMPT: request.systemPrompt } } : {}),
      ...(mcpServers.length ? { editor: { edit_approval_policy: 'ask', mcp_servers: mcpServers } } : {})
    })
    const liveSessionId = String(snap.session_id)
    const storedSessionId = String(snap.stored_session_id ?? snap.session_id)
    const generation = typeof snap.execution_generation === 'number' ? snap.execution_generation : 0
    seedHermesUsage(state, undefined, true)
    await socket.request('session.mutate', {
      session_id: storedSessionId,
      request_id: `edit-policy-${request.runId}`,
      expected_revision: typeof snap.revision === 'number' ? snap.revision : 0,
      expected_generation: generation,
      operation: 'edit_policy',
      payload: { policy: 'session' }
    })
    approveSnapshotPrompts(socket, snap, liveSessionId, generation)
    return { ok: true, session: { liveSessionId, storedSessionId, generation, baselineMessages: 0, created: true, fallbackNote } }
  }

  const snap = await socket.request('session.resume', { session_id: request.sessionId, source: 'acp', display_projection: true })
  const liveSessionId = String(snap.session_id)
  const storedSessionId = String(snap.stored_session_id ?? snap.session_id)
  const generation = typeof snap.execution_generation === 'number' ? snap.execution_generation : 0
  const baselineMessages = Array.isArray(snap.display_messages) ? snap.display_messages.length : 0
  seedHermesUsage(state, await socket.request('session.stats', { session_id: storedSessionId }).catch(() => undefined), false)
  if (mcpServers.length) {
    await socket.request('session.mutate', {
      session_id: storedSessionId,
      request_id: `editor-mcp-${request.runId}`,
      expected_revision: typeof snap.revision === 'number' ? snap.revision : 0,
      expected_generation: generation,
      operation: 'editor_mcp',
      payload: { mcp_servers: mcpServers }
    })
  }
  approveSnapshotPrompts(socket, snap, liveSessionId, generation)
  return { ok: true, session: { liveSessionId, storedSessionId, generation, baselineMessages, created: false } }
}

export async function steerHermesSession(
  socket: HermesWorkerSocket,
  liveSessionId: string,
  storedSessionId: string | undefined,
  generation: number,
  text: string,
  updateGeneration: (next: number) => void
): Promise<'steered' | 'not_running'> {
  const send = (gen: number) => socket.request('session.steer', { session_id: liveSessionId, execution_generation: gen, text }, 10_000)
  try {
    const res = await send(generation)
    return res?.status === 'queued' || res?.status === 'redirected' ? 'steered' : 'not_running'
  } catch (error) {
    if (error instanceof HermesRpcError && error.reason === 'stale_generation' && socket.isOpen && storedSessionId) {
      const nextGen =
        error.executionGeneration ??
        (await socket.request('session.resume', { session_id: storedSessionId, source: 'acp', omit_messages: true }).catch(() => null))?.execution_generation
      if (typeof nextGen === 'number') {
        updateGeneration(nextGen)
        const retry = await send(nextGen).catch(() => null)
        return retry?.status === 'queued' || retry?.status === 'redirected' ? 'steered' : 'not_running'
      }
    }
    return 'not_running'
  }
}

export async function recoverDroppedHermesTurn(
  dial: () => Promise<HermesWorkerSocket>,
  storedSessionId: string,
  admissionId: string | undefined,
  state: HermesStreamState,
  waitTurn: () => Promise<'event' | 'closed' | 'stop_timeout'>,
  onResumed: (socket: HermesWorkerSocket, liveSessionId: string, generation: number) => void
) {
  try {
    const socket = await dial()
    const res = await socket.request('session.resume', { session_id: storedSessionId, source: 'acp', display_projection: true })
    const liveSessionId = String(res.session_id)
    const generation = typeof res.execution_generation === 'number' ? res.execution_generation : 0
    onResumed(socket, liveSessionId, generation)
    approveSnapshotPrompts(socket, res, liveSessionId, generation)
    const receipt = admissionId ? await socket.request('prompt.receipt', { session_id: storedSessionId, admission_id: admissionId }).catch(() => null) : null
    if (receipt?.status === 'terminal' || res.running === false) {
      const ok = receipt?.outcome === 'completed' || !receipt
      state.complete = { status: ok ? 'completed' : receipt?.outcome === 'interrupted' ? 'stopped' : 'failed', text: state.text }
    } else await waitTurn()
  } catch {}
}

export function buildHermesOutcome(
  state: HermesStreamState,
  finalSnap: Record<string, any> | null,
  baselineMessages: number,
  storedSessionId: string | undefined,
  stopped: boolean,
  fallbackNote?: string,
  secret?: string
): WorkerOutcome {
  for (const item of state.tools.values()) item.running = false
  const mapped = finalSnap ? mapHermesTranscript(finalSnap.display_messages, baselineMessages, secret) : []
  const finalItems = mapped.length ? mapped : state.items
  const baseText =
    state.complete?.text ||
    finalItems
      .filter(i => i.kind === 'assistant')
      .map(i => i.text)
      .join('\n\n') ||
    state.text
  const session = storedSessionId ? { sessionId: storedSessionId } : {}
  if (stopped || state.complete?.status === 'stopped') return { ...session, status: 'stopped', text: baseText, items: finalItems, usage: state.usage }
  if (!state.complete) return { ...session, status: 'interrupted', text: baseText, items: finalItems, usage: state.usage, error: 'Connection to Hermes gateway was lost.' }
  if (state.complete.status === 'failed')
    return { ...session, status: 'failed', text: '', items: finalItems, usage: state.usage, error: state.complete.error ?? 'Hermes worker failed.' }
  const text = fallbackNote ? `[${fallbackNote}]${baseText ? `\n\n${baseText}` : ''}` : baseText
  return { ...session, status: 'completed', text, items: finalItems, usage: state.usage }
}
