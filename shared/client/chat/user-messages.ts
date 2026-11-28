/** User messages in the chat view: sent from this page, confirmed by the server, or arriving from another device or
 *  tab. Pure functions only. */
import type { AttachmentMessage } from '../../attachment-schema'
import type { ChatView, UserItem, ViewItem } from './chat-state'

export function withUserMessage(chat: ChatView, message: string | UserItem): ChatView {
  const item: UserItem = typeof message === 'string' ? { kind: 'user', text: message } : message
  if (chat.running) return { ...chat, items: [...chat.items, item], queued: [...chat.queued, item] }
  return { ...chat, items: [...chat.items, item], awaitingStart: true, turnStart: chat.items.length, running: true, activity: 'Sending...' }
}

const isMessage = (id: string) => (item: ViewItem) => item.kind === 'user' && item.messageId === id

/** The server's record of a message (the `chat.send` answer or the `user.message` event, whichever
 *  comes first) fills in the message already on screen with the same id. Every other item keeps
 *  its object, so memoised rows and the scroller see no change. */
export function withSentMessage(chat: ChatView, message: AttachmentMessage): ChatView {
  const { text, attachments, images, origin } = message
  const at = chat.items.findIndex(isMessage(message.messageId))
  if (at < 0) return chat
  const old = chat.items[at] as UserItem
  const filled: UserItem = { ...old, text, attachments, images, ...(origin ? { origin } : {}) }
  // A waiting message is the same object in `items` and `queued`, so both get the filled one.
  return { ...chat, items: chat.items.map(item => (item === old ? filled : item)), queued: chat.queued.map(item => (item === old ? filled : item)) }
}

/** The `user.message` event. A message this page did not send (another device or tab) joins the
 *  conversation as if it had been sent here. The engine may start its turn before the server
 *  publishes it; then it goes where that turn's output begins. */
export function withArrivedMessage(chat: ChatView, message: AttachmentMessage): ChatView {
  if (chat.items.some(isMessage(message.messageId))) return withSentMessage(chat, message)
  const item: UserItem = { kind: 'user', ...message }
  const at = chat.bareTurn
  if (at === null) return withUserMessage(chat, item)
  return { ...chat, items: [...chat.items.slice(0, at), item, ...chat.items.slice(at)], bareTurn: null }
}
