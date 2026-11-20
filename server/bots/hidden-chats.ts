/** An engine may continue a long session under a new id after compressing it. Anything LilBot knows about the session
 *  (a routine or webhook run, a bot thread) still holds for the continuation, so lookups follow the compression
 *  lineage back to where it began. A root never changes, so it is remembered. */
import type { BotEngine } from '../engines/bot-engine'
import type { BotStore } from './bot-store'

const REMEMBERED = 5000
const WARN_EVERY_MS = 60_000

/** The session a chat's lineage began as: the chat itself when it is not a continuation (or the engine never continues
 *  one), null when the engine cannot read the lineage just now; that is asked again next time, never remembered. */
export type SessionRoot = (botId: string, chatId: string) => string | null

export function sessionRoots(engine: BotEngine, store: BotStore): SessionRoot {
  const roots = new Map<string, string>()
  let warnedAt = 0
  return (botId, chatId) => {
    const key = `${botId}\n${chatId}`
    const known = roots.get(key)
    if (known !== undefined) return known
    if (!engine.compressionRoot || !store.exists(botId)) return chatId
    const found = engine.compressionRoot(store.get(botId).engineBotId, chatId)
    if (found === null) {
      if (Date.now() - warnedAt > WARN_EVERY_MS) {
        warnedAt = Date.now()
        console.warn('[session-lineage] could not read a session lineage; it counts as hidden and is not attributed')
      }
      return null
    }
    if (roots.size >= REMEMBERED) roots.clear()
    roots.set(key, found)
    return found
  }
}

/** Sessions LilBot runs itself are never history, never activity of their own and never reviewed for memory, nor are
 *  their continuations. An unreadable lineage counts as hidden (it fails closed). */
export function hiddenChats(rootOf: SessionRoot, own: (chatId: string) => boolean) {
  return (botId: string, chatId: string) => {
    if (own(chatId)) return true
    const root = rootOf(botId, chatId)
    return root === null || (root !== chatId && own(root))
  }
}
