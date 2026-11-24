/** Pure FlatList row builder for the inverted transcript: skips session dividers, keeps queued
 *  attachments and original MessageItem object references intact (preserving React.memo), and
 *  assigns unique keys even when queued messages omit an optional messageId. */
import type { ChatView, MessageItem } from '../../../shared/client/chat/chat-state'

export interface MessageRow {
  key: string
  item: MessageItem
  queued: boolean
}

export function buildMessageRows(items: ChatView['items'], queued: ChatView['queued']): MessageRow[] {
  const sent: MessageRow[] = []
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.kind === 'session') continue
    sent.push({ key: `item-${i}`, item, queued: false })
  }
  const waiting: MessageRow[] = queued.map((message, index) => ({
    key: `queued-${message.messageId ?? index}`,
    item: message as MessageItem,
    queued: true
  }))
  return [...sent, ...waiting].reverse()
}
