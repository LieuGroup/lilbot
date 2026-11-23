import type { ChatItem, TurnUsage } from '../../../shared/chat-schema'
import type { ChatOptions, RoutineOptions } from '../bot-engine'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { itemsFromRows } from './hermes-chat-mapping'
import { saveFailed } from './hermes-memory-saves'
import { ensureFullAccess } from './hermes-permissions'
import { HermesSocket } from './hermes-socket'
import { reportToolCall } from './hermes-tool-calls'
import { TurnUsageTracker } from './hermes-usage'

function annotateFinish(items: ChatItem[], stopped: boolean, usage?: TurnUsage): ChatItem[] {
  if (!stopped && !usage) return items
  let index = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === 'assistant') {
      index = i
      break
    }
  }
  if (index < 0) return items
  const last = items[index]
  if (last.kind !== 'assistant') return items
  const updated: ChatItem = { ...last, ...(stopped ? { stopped: true } : {}), ...(usage ? { usage } : {}) }
  return items.map((item, i) => (i === index ? updated : item))
}

/** Hidden from main/history listings, but explicitly openable by its stored session id.
 * Repeating create and submit after a lost connection recovers their durable receipts. */
export async function runRoutine(botId: string, prompt: string, options: RoutineOptions & ChatOptions, connect = HermesSocket.connect) {
  const profile = botId === DEFAULT_PROFILE ? '' : botId
  let sessionId = ''
  const usage = new TurnUsageTracker()
  let lastUsage: TurnUsage | undefined
  // Hidden sessions have no event replay; this socket is where their tool calls and turn usage are seen.
  const socket = await connect(
    profile,
    event => {
      reportToolCall(profile, event.sessionId, event.type, event.payload)
      if (event.sessionId && sessionId && event.sessionId !== sessionId) return
      if (event.type === 'session.usage') usage.onSessionUsage(event.payload)
      else if (event.type === 'message.start') usage.onTurnStart()
      else if (event.type === 'message.complete') {
        const tracked = usage.onComplete(event.payload)
        if (tracked?.usage) lastUsage = tracked.usage
      }
    },
    () => {}
  )
  try {
    await ensureFullAccess(socket)
    const session = options.chatId
      ? await socket.request('session.resume', { session_id: options.chatId, source: 'tool', display_projection: true })
      : await socket.request('session.create', {
          source: 'tool',
          hidden: true,
          yolo: true,
          request_id: `routine-${options.runId}`,
          client: { name: 'lilbot', version: '0.2.0' },
          cwd: options.workspace,
          cwd_explicit: true,
          ...(options.toolsets ? { toolsets: options.toolsets } : {}),
          ...(options.model ? { model: options.model.model, provider: options.model.provider } : {}),
          ...(options.reasoningEffort ? { reasoning: options.reasoningEffort } : {})
        })
    sessionId = typeof session.session_id === 'string' ? session.session_id : ''
    usage.seedInfo(session.info, !options.chatId)
    // Both identities are persisted before the prompt can run (also excludes memory reviews).
    for (const id of new Set([session.stored_session_id, session.session_id])) if (typeof id === 'string') options.onChat(id)
    const base = options.baseline?.(itemsFromRows(session.display_messages).length) ?? 0
    const submitted = await socket.request('prompt.submit', {
      session_id: session.session_id,
      text: prompt,
      ...(options.origin ? { api_text: `${prompt}\n\n${options.origin.line}` } : {}),
      input_id: `routine-${options.runId}`,
      queued: !!options.chatId,
      ...(options.hiddenInput ? { display_kind: 'hidden' } : {})
    })
    // Receipts survive event replay truncation and process/gateway restarts.
    for (;;) {
      const receipt = await socket.request('prompt.receipt', { session_id: session.session_id, admission_id: submitted.admission_id })
      if (receipt.status === 'terminal' || receipt.status === 'unknown') {
        const snapshot = await socket.request('session.resume', { session_id: session.stored_session_id, source: 'tool', display_projection: true })
        const sessions = [session.stored_session_id, session.session_id, snapshot.stored_session_id].filter((id): id is string => typeof id === 'string')
        const items = itemsFromRows(snapshot.display_messages, at => saveFailed(profile, sessions, at))
        const last = items.filter(item => item.kind === 'assistant').at(-1)
        const switched = typeof snapshot.stored_session_id === 'string' && typeof session.stored_session_id === 'string' && snapshot.stored_session_id !== session.stored_session_id
        const sliced = !switched && base < items.length ? items.slice(base) : items
        const turnItems = receipt.outcome === 'completed' && sliced.every(item => item.kind === 'user') ? items : sliced
        const status = receipt.outcome === 'completed' ? ('completed' as const) : receipt.outcome === 'interrupted' ? ('stopped' as const) : ('failed' as const)
        return {
          items: annotateFinish(turnItems, status === 'stopped', lastUsage),
          status,
          text: last ? last.text : `Routine ended: ${receipt.outcome ?? receipt.status}. Execution was not retried.`,
          ...(receipt.status === 'unknown' ? { unknownReceipt: true as const } : {})
        }
      }
      await Bun.sleep(1000)
    }
  } finally {
    socket.close()
  }
}
