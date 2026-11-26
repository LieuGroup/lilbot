/** Where a finished reply's actions (Copy, turn numbers) go, and what Copy copies (#317, F4). A reply is everything the
 *  bot drew after a message: words split by tool lines and shown items. It gets one actions row, under its last word
 *  segment or shown item, and Copy joins every word segment of it, so an item or a tool in the middle loses no words.
 *  Items themselves add nothing to the copied text. */
import type { TurnUsage } from '../../chat-schema'
import type { ViewItem } from './chat-state'

export interface ReplyActions {
  /** Every word segment of the reply, in order, joined by a blank line. */
  text: string
  /** The turn's numbers, from the segment that carries them. */
  usage?: TurnUsage
}

const ENDS_REPLY = new Set<ViewItem['kind']>(['user', 'session', 'compaction'])

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
    } else if (item.kind === 'shown') host = index
  })
  close()
  return hosts
}
