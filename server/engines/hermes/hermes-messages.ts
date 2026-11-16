import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { ensureFullAccess } from './hermes-permissions'
import { HermesSocket } from './hermes-socket'

/** Hermes has no append-assistant RPC. This is a visible, explicitly attributed app prompt.
 * Receipt polling reuses the same admission on retry; a terminal unknown is never re-executed. */
export async function deliverMessage(botId: string, chatId: string, text: string, messageId: string, connect = HermesSocket.connect) {
  const socket = await connect(
    botId === DEFAULT_PROFILE ? '' : botId,
    () => {},
    () => {}
  )
  try {
    await ensureFullAccess(socket)
    const session = await socket.request('session.resume', { session_id: chatId, source: 'tool', display_projection: true })
    const submitted = await socket.request('prompt.submit', {
      session_id: session.session_id,
      text,
      input_id: `report-${messageId}`,
      turn_author: { id: 'lilbot-reports', name: 'LilBot reports', is_bot: true, origin: 'report' }
    })
    for (;;) {
      const receipt = await socket.request('prompt.receipt', { session_id: session.session_id, admission_id: submitted.admission_id, include_result: true })
      if (receipt.status === 'terminal' || receipt.status === 'unknown') {
        return {
          status: receipt.outcome === 'completed' ? ('completed' as const) : receipt.outcome === 'interrupted' ? ('stopped' as const) : ('failed' as const),
          text: typeof receipt.result?.final_response === 'string' ? receipt.result.final_response : ''
        }
      }
      await Bun.sleep(1000)
    }
  } finally {
    socket.close()
  }
}
