/** User messages in the chat view: sent from this page, confirmed by the server, or arriving from another device or
 *  tab. Pure functions only. */
import type { AttachmentMessage } from '../../../shared/attachment-schema'
import type { ChatView, UserItem, ViewItem } from './chat-state'

export function withUserMessage(chat: ChatView, message: string | UserItem): ChatView {
  const item: UserItem = typeof message === 'string' ? { kind: 'user', text: message } : message
  if (chat.running) return { ...chat, queued: [...chat.queued, item] }
  return { ...chat, items: [...chat.items, item], awaitingStart: true, running: true, activity: 'Sending...' }
}

const isMessage = (id: string) => (item: ViewItem) => item.kind === 'user' && item.messageId === id

/** The server's record of a message (the `chat.send` answer or the `user.message` event, whichever
 *  comes first) fills in the message already on screen with the same id. Every other item keeps
 *  its object, so memoised rows and the scroller see no change. */
export function withSentMessage(chat: ChatView, message: AttachmentMessage): ChatView {
  const { text, attachments, images, origin } = message
  const fill = <T extends ViewItem>(item: T): T => (isMessage(message.messageId)(item) ? { ...item, text, attachments, images, ...(origin ? { origin } : {}) } : item)
  if (chat.items.some(isMessage(message.messageId))) return { ...chat, items: chat.items.map(fill) }
  if (chat.queued.some(isMessage(message.messageId))) return { ...chat, queued: chat.queued.map(fill) }
  return chat
}

/** The `user.message` event. A message this page did not send (another device or tab) joins the
 *  conversation as if it had been sent here. The engine may start its turn before the server
 *  publishes it; then it goes where that turn's output begins. */
export function withArrivedMessage(chat: ChatView, message: AttachmentMessage): ChatView {
  const known = chat.items.some(isMessage(message.messageId)) || chat.queued.some(isMessage(message.messageId))
  if (known) return withSentMessage(chat, message)
  const item: UserItem = { kind: 'user', ...message }
  const at = chat.bareTurn
  if (at === null) return withUserMessage(chat, item)
  return { ...chat, items: [...chat.items.slice(0, at), item, ...chat.items.slice(at)], bareTurn: null }
}
