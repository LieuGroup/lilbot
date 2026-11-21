import { LilBotError } from '../../shared/lilbot-error'
import type { EngineApiOptions } from './engine-api'

/** The thread routes kept for sessions that loaded adapter 0.9.x (`ask_bot`, `list_bots`). Caller comes from the
 *  authenticated capability, never from the request body. */
export async function threadApi({ threads, bots }: EngineApiOptions, callerId: string, action: string, body: unknown) {
  if (!threads || !bots) throw new LilBotError('unavailable', 'Threads unavailable.')
  if (action === 'bots') return (await bots.listBots()).map(b => ({ id: b.id, name: b.name, function: b.function }))
  if (action === 'ask') return threads.ask(callerId, body as Parameters<typeof threads.ask>[1])
  if (action === 'list') return threads.list(callerId)
  if (action === 'open') return threads.open(callerId, String((body as { threadId?: unknown } | null)?.threadId))
  throw new LilBotError('unknown_method', 'Unknown thread operation.')
}
