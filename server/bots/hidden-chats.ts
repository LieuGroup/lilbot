/** Sessions LilBot runs itself (routine and webhook runs, bot threads) are never history, never activity of their
 *  own and never reviewed for memory. An engine may continue such a session under a new id after compressing it, so
 *  the check follows the compression lineage back to where it began. A root never changes, so it is remembered. When
 *  the engine cannot read the lineage the session counts as hidden (it fails closed) and is asked about again later. */
import type { BotEngine } from '../engines/bot-engine'
import type { BotStore } from './bot-store'

const REMEMBERED = 5000
const WARN_EVERY_MS = 60_000

export function hiddenChats(engine: BotEngine, store: BotStore, own: (chatId: string) => boolean) {
  const roots = new Map<string, string>()
  let warnedAt = 0
  return (botId: string, chatId: string) => {
    if (own(chatId)) return true
    const key = `${botId}\n${chatId}`
    let root = roots.get(key)
    if (root === undefined) {
      if (!engine.compressionRoot || !store.exists(botId)) return false
      const found = engine.compressionRoot(store.get(botId).engineBotId, chatId)
      if (found === null) {
        if (Date.now() - warnedAt > WARN_EVERY_MS) {
          warnedAt = Date.now()
          console.warn('[hidden-chats] could not read a session lineage; treating the session as hidden')
        }
        return true
      }
      if (roots.size >= REMEMBERED) roots.clear()
      roots.set(key, found)
      root = found
    }
    return root !== chatId && own(root)
  }
}
