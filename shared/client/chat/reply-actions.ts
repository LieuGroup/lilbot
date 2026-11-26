/** Where a finished reply's actions (Copy, turn numbers) go, and what Copy copies (#317, F4). A reply is one turn of the
 *  bot: its words split by tool lines and shown items. It gets one actions row, under its last word segment or shown
 *  item, and Copy joins every word segment of it, so an item or a tool in the middle loses no words. Items themselves add
 *  nothing to the copied text.
 *
 *  Copy and the numbers follow turns, not messages. A reply ends:
 *  - after a part that carries the turn's numbers (`usage`) or its "stopped" mark: the engine puts them on the turn's
 *    last words, live (`turn.finished` in `chat-state.ts`) and stored (`history-tail.ts`, `history-meta-store.ts`), so
 *    turns the bot runs on its own, which add no message, each keep their own;
 *  - at an error line, a new session or a compaction mark;
 *  - at a message from the owner, unless the reply goes on after it and reaches its end mark before any other message
 *    or break. That message was sent while the bot was busy and is drawn where it was sent (#325), inside the reply.
 *    A reply with no end mark (older history, a turn that ended on an item) ends at the next message, as before. */
import type { TurnUsage } from '../../chat-schema'
import type { ViewItem } from './chat-state'

export interface ReplyActions {
  /** Every word segment of the reply, in order, joined by a blank line. */
  text: string
  /** The turn's numbers, from the segment that carries them. */
  usage?: TurnUsage
}

const BREAKS = new Set<ViewItem['kind']>(['session', 'compaction', 'error'])
const endsTurn = (item: ViewItem) => item.kind === 'assistant' && !item.streaming && (item.usage !== undefined || item.stopped === true)
const writing = (item: ViewItem) => item.kind === 'assistant' && item.streaming === true

/** A message inside an open reply belongs to it when the reply goes on to its own end mark (or is still being written)
 *  before any other message or break. */
function sentMidReply(items: readonly ViewItem[], at: number) {
  for (let i = at + 1; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'user' || BREAKS.has(item.kind)) return false
    if (endsTurn(item) || writing(item)) return true
  }
  return false
}

/** Index of the item that carries each reply's actions, keyed by that index. A reply still being written has none. */
export function replyActions(items: readonly ViewItem[]): Map<number, ReplyActions> {
  const hosts = new Map<number, ReplyActions>()
  let words: string[] = []
  let usage: TurnUsage | undefined
  let host = -1
  let open = false
  const close = () => {
    if (host >= 0 && !open && words.length > 0) hosts.set(host, { text: words.join('\n\n'), ...(usage ? { usage } : {}) })
    words = []
    usage = undefined
    host = -1
    open = false
  }
  items.forEach((item, index) => {
    if (BREAKS.has(item.kind)) close()
    else if (item.kind === 'user') {
      if (!(host >= 0 && sentMidReply(items, index))) close()
    } else if (item.kind === 'assistant') {
      if (item.text) words.push(item.text)
      if (item.usage) usage = item.usage
      if (item.streaming) open = true
      host = index
      if (endsTurn(item)) close()
    } else if (item.kind === 'shown') host = index
  })
  close()
  return hosts
}
