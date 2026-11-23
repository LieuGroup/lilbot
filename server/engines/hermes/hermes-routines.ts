import { LilBotError } from '../../../shared/lilbot-error'
import type { ChatOptions, RoutineOptions } from '../bot-engine'
import { hermesToolsetsForRun } from './hermes-access'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { itemsFromRows } from './hermes-chat-mapping'
import { ensureFullAccess } from './hermes-permissions'
import { HermesSocket } from './hermes-socket'
import { reportToolCall } from './hermes-tool-calls'

const notFound = (error: unknown) => error instanceof LilBotError && error.code === 'hermes_not_found'

/** Confirm a "not found" resume on a second fresh connection before calling the session gone, matching `hermes-chat.ts`. */
async function resumeSession(profile: string, chatId: string, socket: HermesSocket, connect: typeof HermesSocket.connect): Promise<{ socket: HermesSocket; session: any }> {
  const resume = (s: HermesSocket) => s.request('session.resume', { session_id: chatId, source: 'tool', display_projection: true })
  try {
    return { socket, session: await resume(socket) }
  } catch (error) {
    if (!notFound(error)) throw error
    socket.close()
    const fresh = await connect(
      profile,
      event => reportToolCall(profile, event.sessionId, event.type, event.payload),
      () => {}
    )
    try {
      await ensureFullAccess(fresh)
      return { socket: fresh, session: await resume(fresh) }
    } catch (retryError) {
      fresh.close()
      if (notFound(retryError)) throw new LilBotError('session_not_found', 'That conversation no longer exists.')
      throw retryError
    }
  }
}

/** Hidden from main/history listings, but explicitly openable by its stored session id.
 * Repeating create and submit after a lost connection recovers their durable receipts. */
export async function runRoutine(botId: string, prompt: string, options: RoutineOptions & ChatOptions, connect = HermesSocket.connect) {
  const profile = botId === DEFAULT_PROFILE ? '' : botId
  // Hidden sessions have no event replay; this socket is where their tool calls are seen.
  let socket = await connect(
    profile,
    event => reportToolCall(profile, event.sessionId, event.type, event.payload),
    () => {}
  )
  try {
    await ensureFullAccess(socket)
    let session: any
    if (options.chatId) {
      const resumed = await resumeSession(profile, options.chatId, socket, connect)
      socket = resumed.socket
      session = resumed.session
    } else {
      const toolsets = hermesToolsetsForRun(options.access, options.toolsets)
      session = await socket.request('session.create', {
        source: 'tool',
        hidden: true,
        yolo: true,
        request_id: `routine-${options.runId}`,
        client: { name: 'lilbot', version: '0.2.0' },
        cwd: options.workspace,
        cwd_explicit: true,
        ...(toolsets ? { toolsets } : {}),
        ...(options.model ? { model: options.model.model, provider: options.model.provider } : {}),
        ...(options.reasoningEffort ? { reasoning: options.reasoningEffort } : {})
      })
    }
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
        const switched = typeof snapshot.stored_session_id === 'string' && typeof session.stored_session_id === 'string' && snapshot.stored_session_id !== session.stored_session_id
        const sliced = !switched && base < items.length ? items.slice(base) : items
        const turnItems = receipt.outcome === 'completed' && sliced.every(item => item.kind === 'user') ? items : sliced
        return {
          items: turnItems,
          status: receipt.outcome === 'completed' ? ('completed' as const) : receipt.outcome === 'interrupted' ? ('stopped' as const) : ('failed' as const),
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
