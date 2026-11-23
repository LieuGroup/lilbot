import { LilBotError } from '../../shared/lilbot-error'
import { assertNarrowedAllowed, withinNarrowed } from '../threads/thread-accept'
import type { EngineApiOptions } from './engine-api'

/** The thread routes kept for sessions that loaded adapter 0.9.x (`ask_bot`, `list_bots`). Caller comes from the
 *  authenticated capability, never from the request body. */
export async function threadApi({ threads, bots, sessionCapabilities }: EngineApiOptions, callerId: string, action: string, body: unknown, session?: string) {
  if (!threads || !bots) throw new LilBotError('unavailable', 'Threads unavailable.')
  if (action === 'bots') return (await bots.listBots()).map(b => ({ id: b.id, name: b.name, function: b.function }))
  if (action === 'ask') {
    const raw = body && typeof body === 'object' ? (body as Record<string, unknown>) : {}
    return threads.ask(callerId, (session ? { ...raw, chatId: session } : raw) as Parameters<typeof threads.ask>[1])
  }
  const caps = sessionCapabilities?.(callerId, session) ?? null
  if (action === 'list') return (await threads.list(callerId)).filter(thread => withinNarrowed(caps, thread))
  if (action === 'open') {
    const thread = await threads.open(callerId, String((body as { threadId?: unknown } | null)?.threadId))
    assertNarrowedAllowed(caps, { existing: thread })
    return thread
  }
  throw new LilBotError('unknown_method', 'Unknown thread operation.')
}
