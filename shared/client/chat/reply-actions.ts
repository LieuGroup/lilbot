/** Where a finished reply's actions (Copy, turn numbers) go, and what Copy copies (#317, F4). A reply is one turn of the
 *  bot: its words split by tool lines and shown items. It gets one actions row, under its last word segment or shown
 *  item, and Copy joins every word segment of it, so an item or a tool in the middle loses no words. Items themselves add
 *  nothing to the copied text.
 *
 *  Copy and the numbers follow turns. A reply ends after a part that carries the turn's numbers (`usage`) or its
 *  "stopped" mark (the engine puts them on the turn's last words, live in `chat-state.ts` and stored in `history-tail.ts`
 *  and `history-meta-store.ts`), so turns the bot runs on its own, which add no message, keep their own. It also ends at
 *  an error line, a new session, a compaction mark and a message from the owner.
 *
 *  Not solved: a message sent while the bot was busy, drawn where it was sent (#325), splits the reply it sits in.
 *  Nothing an item carries says it was sent mid-turn, and a time gap is no proof (a long tool run looks the same), so
 *  this does not guess. It needs the server to mark such a message (see #334). */
import type { TurnUsage } from '../../chat-schema'
import type { ViewItem } from './chat-state'

export interface ReplyActions {
  /** Every word segment of the reply, in order, joined by a blank line. */
  text: string
  /** The turn's numbers, from the segment that carries them. */
  usage?: TurnUsage
}

const ENDS_REPLY = new Set<ViewItem['kind']>(['user', 'session', 'compaction', 'error'])
const endsTurn = (item: ViewItem) => item.kind === 'assistant' && !item.streaming && (item.usage !== undefined || item.stopped === true)

/** Index of the item that carries each reply's actions, keyed by that index. A reply still being written has none. */
export function replyActions(items: readonly ViewItem[]): Map<number, ReplyActions> {
  const hosts = new Map<number, ReplyActions>()
  let words: string[] = []
  let usage: TurnUsage | undefined
  let host = -1
  let writing = false
  const close = () => {
    if (host >= 0 && !writing && words.length > 0) hosts.set(host, { text: words.join('\n\n'), ...(usage ? { usage } : {}) })
    words = []
    usage = undefined
    host = -1
    writing = false
  }
  items.forEach((item, index) => {
    if (ENDS_REPLY.has(item.kind)) close()
    else if (item.kind === 'assistant') {
      if (item.text) words.push(item.text)
      if (item.usage) usage = item.usage
      if (item.streaming) writing = true
      host = index
      if (endsTurn(item)) close()
    } else if (item.kind === 'shown') host = index
  })
  close()
  return hosts
}
