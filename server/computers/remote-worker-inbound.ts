/** Inbound helper worker-frame dispatcher and `WorkerStartFrame` builder for `RemoteWorkerRunner`.
 *  Validates every frame structurally, enforces computer/run ownership, updates persisted session ids, emits safe
 *  tool activity, forwards scoped MCP calls, and settles `worker.done` at most once. */
import type { ChatItem } from '../../shared/chat-schema'
import { WorkerHelperFrame, WorkerLeaderFrame, WorkerStartFrame } from '../../shared/worker-frame-schema'
import { remoteToolActivity, sanitizeWorkerDone, sanitizeWorkerEvent } from './remote-worker-sanitize'
import type { RemoteWorkerResult } from './remote-worker-store'
import type { ActiveRun, PendingSteer, RemoteToolEvent, RemoteWorkerMcpContext, RemoteWorkerRunInput } from './remote-worker-types'

const MAX_MCP_RESPONSE_BYTES = 262_144
const MAX_SEEN_TOOLS = 500

export interface InboundHooks {
  runs: Map<string, ActiveRun>
  steers: Map<string, PendingSteer>
  peerOf: (computerId: string) => ((frame: WorkerLeaderFrame) => boolean) | undefined
  isSettled: (computerId: string, runId: string) => boolean
  updateSession: (runId: string, sessionId: string) => void
  botExists: (botId: string) => boolean
  handleMcp: (ctx: RemoteWorkerMcpContext, body: string) => Promise<{ status: number; body: string }>
  emitTool: (event: RemoteToolEvent) => void
  finishSteer: (steerId: string, status: 'steered' | 'not_running') => void
  stopActive: (run: ActiveRun) => boolean
  settleRun: (runId: string, result: RemoteWorkerResult, sessionId?: string) => void
}

export const snapshotToolItems = (run: ActiveRun): ChatItem[] => [...run.tools.values()].map(item => ({ ...item, running: false }))

export function handlePeerConnect(
  peers: Map<string, (frame: WorkerLeaderFrame) => boolean>,
  runs: Map<string, ActiveRun>,
  steers: Map<string, PendingSteer>,
  computerId: string,
  send: (frame: WorkerLeaderFrame) => boolean,
  hooks: Pick<InboundHooks, 'finishSteer' | 'settleRun'> & { isRevoked: (cid: string) => boolean; armOfflineTimer: (run: ActiveRun) => void }
) {
  peers.set(computerId, send)
  for (const run of runs.values()) {
    if (run.computerId !== computerId) continue
    clearTimeout(run.offlineTimer)
    run.offlineTimer = undefined
    if (run.pendingStart && !run.sentStart && send(run.pendingStart)) run.sentStart = true
  }
  return () => {
    if (peers.get(computerId) !== send) return
    peers.delete(computerId)
    for (const [id, steer] of [...steers]) if (steer.computerId === computerId) hooks.finishSteer(id, 'not_running')
    const revoked = hooks.isRevoked(computerId)
    for (const run of [...runs.values()]) {
      if (run.computerId !== computerId) continue
      if (revoked)
        hooks.settleRun(run.runId, {
          status: 'failed',
          text: 'The computer was removed while the worker was running.',
          items: snapshotToolItems(run),
          failureReason: 'computer_removed'
        })
      else hooks.armOfflineTimer(run)
    }
  }
}

export function makeActiveRun(
  row: { runId: string; computerId: string; botId: string; threadId: string; chatId: string; sessionId?: string | null },
  sentStart: boolean
): ActiveRun {
  return {
    runId: row.runId,
    computerId: row.computerId,
    botId: row.botId,
    threadId: row.threadId,
    chatId: row.chatId,
    sessionId: row.sessionId ?? undefined,
    sentStart,
    stopping: false,
    emittedWorking: false,
    seenToolIds: new Set(),
    tools: new Map(),
    confirmedSteers: [],
    waiters: []
  }
}

export function buildStartFrame(input: RemoteWorkerRunInput, resumeSession?: string): { ok: true; frame: WorkerStartFrame } | { ok: false; failure: RemoteWorkerResult } {
  const checked = WorkerStartFrame.safeParse({
    type: 'worker.start',
    runId: input.runId,
    ...(input.driver ? { driver: input.driver } : {}),
    ...(resumeSession ? { sessionId: resumeSession } : {}),
    cwd: input.cwd,
    model: input.model,
    ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
    systemPrompt: input.systemPrompt,
    prompt: input.prompt,
    mcpEnabled: true
  })
  if (checked.success) return { ok: true, frame: checked.data }
  const oversized = checked.error.issues.some(i => i.path[0] === 'systemPrompt')
  return {
    ok: false,
    failure: {
      status: 'failed',
      text: oversized ? 'Remote worker system prompt exceeded the 96 KiB limit.' : `Invalid remote worker start request: ${checked.error.issues[0]?.message ?? 'invalid fields'}.`,
      items: [],
      failureReason: oversized ? 'prompt_too_large' : 'invalid_start'
    }
  }
}

export function handleRemoteWorkerInbound(hooks: InboundHooks, computerId: string, rawFrame: unknown, send: (frame: WorkerLeaderFrame) => boolean) {
  const checked = WorkerHelperFrame.safeParse(rawFrame)
  if (!checked.success) return
  const frame = checked.data
  if (frame.type === 'worker.capabilities') return

  const run = hooks.runs.get(frame.runId)
  if (!run || run.computerId !== computerId) {
    if (frame.type === 'worker.done' && hooks.isSettled(computerId, frame.runId)) send({ type: 'worker.ack', runId: frame.runId })
    return
  }

  if (frame.type === 'worker.event') {
    const ev = sanitizeWorkerEvent(frame)
    if (!ev) return
    if (ev.sessionId) {
      run.sessionId = ev.sessionId
      hooks.updateSession(run.runId, ev.sessionId)
    }
    let emitted = false
    for (const tool of ev.tools) {
      if (run.tools.has(tool.toolId) || run.tools.size < MAX_SEEN_TOOLS)
        run.tools.set(tool.toolId, { kind: 'tool', toolId: tool.toolId, name: tool.name, detail: tool.detail, running: tool.running, ...(tool.failed ? { failed: true } : {}) })
      if (tool.running && !run.seenToolIds.has(tool.toolId) && run.seenToolIds.size < MAX_SEEN_TOOLS) {
        run.seenToolIds.add(tool.toolId)
        emitted = true
        hooks.emitTool({ botId: run.botId, chatId: run.chatId, tool: tool.name, activity: remoteToolActivity(tool.name), callId: tool.toolId })
      }
    }
    if (!emitted && ev.activity && !run.emittedWorking) {
      run.emittedWorking = true
      hooks.emitTool({ botId: run.botId, chatId: run.chatId, tool: '', activity: ev.activity })
    }
    return
  }

  if (frame.type === 'worker.steer.result') {
    if (!frame.steerId) return
    const pending = hooks.steers.get(frame.steerId)
    if (pending && pending.runId === run.runId && pending.computerId === computerId) hooks.finishSteer(frame.steerId, frame.status)
    return
  }

  if (frame.type === 'worker.mcp.request') {
    const reply = (status: number, body: string) => {
      const bounded =
        Buffer.byteLength(body, 'utf8') <= MAX_MCP_RESPONSE_BYTES
          ? body
          : JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Response exceeded size limit.' } })
      const out = WorkerLeaderFrame.safeParse({ type: 'worker.mcp.response', runId: frame.runId, callId: frame.callId, status, body: bounded })
      if (out.success) (hooks.peerOf(computerId) ?? send)(out.data)
    }
    if (!hooks.botExists(run.botId)) {
      reply(403, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Bot no longer exists.' } }))
      hooks.stopActive(run)
      return
    }
    void hooks
      .handleMcp({ botId: run.botId, threadId: run.threadId, chatId: run.chatId, runId: run.runId, computerId }, frame.body)
      .then(res => reply(res.status, res.body))
      .catch(() => reply(500, JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'Tool handler failed.' } })))
    return
  }

  if (frame.type === 'worker.done') {
    const done = sanitizeWorkerDone(frame)
    if (!done) {
      hooks.settleRun(run.runId, { status: 'failed', text: 'Invalid worker outcome frame.', items: snapshotToolItems(run), unknownReceipt: true })
      send({ type: 'worker.ack', runId: run.runId })
      return
    }
    const steerItems: ChatItem[] = run.confirmedSteers.map(text => ({ kind: 'user', text }))
    const status: RemoteWorkerResult['status'] = done.status === 'completed' ? 'completed' : done.status === 'stopped' ? 'stopped' : 'failed'
    const text = done.text || (status === 'failed' && done.error ? done.error : '')
    const result: RemoteWorkerResult = {
      status,
      text,
      items: [...done.items, ...steerItems],
      ...(done.sessionId ? { sessionId: done.sessionId } : run.sessionId ? { sessionId: run.sessionId } : {}),
      ...(done.usage ? { usage: done.usage } : {}),
      ...(done.status === 'interrupted' ? { unknownReceipt: true as const, failureReason: 'interrupted' as const } : {})
    }
    hooks.settleRun(run.runId, result, done.sessionId)
    send({ type: 'worker.ack', runId: run.runId })
  }
}
