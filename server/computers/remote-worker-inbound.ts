/** Inbound helper worker-frame dispatcher for `RemoteWorkerRunner`.
 *  Validates every frame structurally, enforces computer/run ownership, blocks MCP calls and forged completions once
 *  a run is stopping, updates persisted session ids, emits safe tool activity, and settles `worker.done` at most once. */
import type { ChatItem } from '../../shared/chat-schema'
import { WorkerHelperFrame, WorkerLeaderFrame } from '../../shared/worker-frame-schema'
import { snapshotToolItems } from './remote-worker-lifecycle'
import { remoteToolActivity, sanitizeWorkerDone, sanitizeWorkerEvent } from './remote-worker-sanitize'
import type { RemoteWorkerResult } from './remote-worker-store'
import type { ActiveRun, PendingSteer, RemoteToolEvent, RemoteWorkerMcpContext } from './remote-worker-types'

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

function parseRpcId(body: string): unknown {
  try {
    const parsed = JSON.parse(body) as { id?: unknown }
    return parsed && typeof parsed === 'object' && 'id' in parsed ? parsed.id : null
  } catch {
    return null
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
    if (run.stopping) return
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
    if (run.stopping || !frame.steerId) return
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
    if (run.stopping)
      return reply(409, JSON.stringify({ jsonrpc: '2.0', id: parseRpcId(frame.body), error: { code: -32000, message: 'Remote worker is stopping; tool calls are refused.' } }))
    if (!hooks.botExists(run.botId)) {
      reply(403, JSON.stringify({ jsonrpc: '2.0', id: parseRpcId(frame.body), error: { code: -32000, message: 'Bot no longer exists.' } }))
      return void hooks.stopActive(run)
    }
    void hooks
      .handleMcp({ botId: run.botId, threadId: run.threadId, chatId: run.chatId, runId: run.runId, computerId }, frame.body)
      .then(res => reply(res.status, res.body))
      .catch(() => reply(500, JSON.stringify({ jsonrpc: '2.0', id: parseRpcId(frame.body), error: { code: -32603, message: 'Tool handler failed.' } })))
    return
  }

  if (frame.type === 'worker.done') {
    const done = sanitizeWorkerDone(frame)
    if (!done) {
      const bad: RemoteWorkerResult = run.stopping
        ? { status: 'stopped', text: '', items: snapshotToolItems(run) }
        : { status: 'failed', text: 'Invalid worker outcome frame.', items: snapshotToolItems(run), unknownReceipt: true }
      hooks.settleRun(run.runId, bad)
      return void send({ type: 'worker.ack', runId: run.runId })
    }
    const steerItems: ChatItem[] = run.confirmedSteers.map(text => ({ kind: 'user', text }))
    const status: RemoteWorkerResult['status'] = run.stopping ? 'stopped' : done.status === 'completed' ? 'completed' : done.status === 'stopped' ? 'stopped' : 'failed'
    const text = done.text || (status === 'failed' && done.error ? done.error : '')
    const result: RemoteWorkerResult = {
      status,
      text,
      items: [...done.items, ...steerItems],
      ...(done.sessionId ? { sessionId: done.sessionId } : run.sessionId ? { sessionId: run.sessionId } : {}),
      ...(done.usage ? { usage: done.usage } : {}),
      ...(!run.stopping && done.status === 'interrupted' ? { unknownReceipt: true as const, failureReason: 'interrupted' as const } : {})
    }
    hooks.settleRun(run.runId, result, done.sessionId)
    send({ type: 'worker.ack', runId: run.runId })
  }
}
