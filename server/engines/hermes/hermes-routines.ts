import type { ChatOptions, RoutineOptions } from '../bot-engine'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { itemsFromRows } from './hermes-chat-mapping'
import { ensureFullAccess } from './hermes-permissions'
import { HermesSocket } from './hermes-socket'
import { reportToolCall } from './hermes-tool-calls'

/** Hidden from main/history listings, but explicitly openable by its stored session id.
 * Repeating create and submit after a lost connection recovers their durable receipts. */
export async function runRoutine(botId: string, prompt: string, options: RoutineOptions & ChatOptions, connect = HermesSocket.connect) {
  const profile = botId === DEFAULT_PROFILE ? '' : botId
  // Hidden sessions have no event replay; this socket is where their tool calls are seen.
  const socket = await connect(
    profile,
    event => reportToolCall(profile, event.sessionId, event.type, event.payload),
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
          ...(options.reasoningEffort ? { reasoning: options.reasoningEffort } : {})
        })
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
        const items = itemsFromRows(snapshot.display_messages)
        const last = items.filter(item => item.kind === 'assistant').at(-1)
        return {
          items: items.slice(base),
          status: receipt.outcome === 'completed' ? ('completed' as const) : receipt.outcome === 'interrupted' ? ('stopped' as const) : ('failed' as const),
          text: last ? last.text : `Routine ended: ${receipt.outcome ?? receipt.status}. Execution was not retried.`
        }
      }
      await Bun.sleep(1000)
    }
  } finally {
    socket.close()
  }
}
