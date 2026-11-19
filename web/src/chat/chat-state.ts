/** What a chat looks like on screen, and how each live event changes it. Pure functions only. */
import type { AttachmentMessage } from '../../../shared/attachment-schema'
import type { ChatEvent, ChatItem, ChatSnapshot } from '../../../shared/chat-schema'
import type { HistoryPage } from '../../../shared/history-schema'

/** `streaming` marks the assistant message that is still being written. */
export type ViewItem = ChatItem & { streaming?: boolean }
/** A message from the user, with its files when it has any. */
export type UserItem = Extract<ChatItem, { kind: 'user' }>

export interface ChatView {
  chatId: string
  items: ViewItem[]
  /** Messages sent while the bot was busy. The engine runs them next; each joins the transcript
   *  when its turn starts, so it never lands in the middle of the reply being written. */
  queued: UserItem[]
  /** A message was sent to an idle bot and its turn has not started yet. */
  awaitingStart: boolean
  running: boolean
  activity: string
  title: string
  /** Counts the times the transcript came from the server rather than from a live event. */
  load: number
}

export const emptyChat: ChatView = { chatId: '', items: [], queued: [], awaitingStart: false, running: false, activity: '', title: '', load: 0 }

/** A reloaded transcript keeps the objects of the items that did not change, so memoised rows
 *  are not drawn again. Items are compared by content; repeated identical items pair in order. */
export function reuseItems(previous: readonly ViewItem[], next: ViewItem[]): ViewItem[] {
  if (previous.length === 0) return next
  const earlier = new Map<string, ViewItem[]>()
  for (const item of previous) {
    const key = JSON.stringify(item)
    const same = earlier.get(key)
    if (same) same.push(item)
    else earlier.set(key, [item])
  }
  return next.map(item => earlier.get(JSON.stringify(item))?.shift() ?? item)
}

export function chatFromSnapshot(snapshot: ChatSnapshot, previous: ChatView = emptyChat): ChatView {
  return {
    chatId: snapshot.chatId,
    items: reuseItems(previous.items, snapshot.items),
    queued: [],
    awaitingStart: false,
    running: snapshot.running,
    activity: snapshot.running ? 'Working...' : '',
    title: snapshot.title,
    load: previous.load + 1
  }
}

/** The bot's saved conversation, shown while its chat is still opening. Nothing can be sent yet;
 *  the chat's own snapshot replaces it moments later. The latest record names the main session. */
export function chatFromHistory(page: HistoryPage, previous: ChatView = emptyChat): ChatView {
  const items: ViewItem[] = page.items.flatMap(row => (row.item.kind === 'session' ? [] : [row.item]))
  return { ...emptyChat, chatId: page.items.at(-1)?.sessionId ?? '', items: reuseItems(previous.items, items), load: previous.load + 1 }
}

export function withUserMessage(chat: ChatView, message: string | UserItem): ChatView {
  const item: UserItem = typeof message === 'string' ? { kind: 'user', text: message } : message
  if (chat.running) return { ...chat, queued: [...chat.queued, item] }
  return { ...chat, items: [...chat.items, item], awaitingStart: true, running: true, activity: 'Sending...' }
}

/** The server's record of a message sent with files (the `chat.send` answer or the `user.message`
 *  event, whichever comes first) fills in the message already on screen with the same id. Every
 *  other item keeps its object, so memoised rows and the scroller see no change. */
export function withSentMessage(chat: ChatView, message: AttachmentMessage): ChatView {
  const fill = <T extends ViewItem>(item: T): T =>
    item.kind === 'user' && item.messageId === message.messageId ? { ...item, text: message.text, attachments: message.attachments, images: message.images } : item
  const has = (items: ViewItem[]) => items.some(item => item.kind === 'user' && item.messageId === message.messageId)
  if (has(chat.items)) return { ...chat, items: chat.items.map(fill) }
  if (has(chat.queued)) return { ...chat, queued: chat.queued.map(fill) }
  return chat
}

export const withError = (chat: ChatView, text: string): ChatView => ({
  ...chat,
  items: [...chat.items, { kind: 'error', text }],
  awaitingStart: false,
  running: false,
  activity: ''
})

const isWriting = (item: ViewItem | undefined) => item?.kind === 'assistant' && item.streaming === true

const stopWriting = (items: ViewItem[]): ViewItem[] => items.map(item => (isWriting(item) ? { ...item, streaming: false } : item))

export function applyChatEvent(chat: ChatView, event: ChatEvent): ChatView {
  switch (event.type) {
    case 'user.message': {
      const { type: _type, ...message } = event
      return withSentMessage(chat, message)
    }
    case 'thread':
      return chat.items.some(i => i.kind === 'tool' && i.threadId === event.threadId)
        ? chat
        : {
            ...chat,
            items: [...chat.items, { kind: 'tool', toolId: `thread:${event.threadId}`, threadId: event.threadId, name: event.name, detail: event.detail, running: false }]
          }
    case 'turn.started': {
      // This turn belongs to the message already in the transcript, or to the oldest queued one.
      if (chat.awaitingStart) return { ...chat, awaitingStart: false, running: true, activity: 'Thinking...' }
      const [next, ...rest] = chat.queued
      const items: ViewItem[] = next === undefined ? chat.items : [...stopWriting(chat.items), next]
      return { ...chat, items, queued: rest, running: true, activity: 'Thinking...' }
    }

    case 'activity':
      return { ...chat, activity: event.text }

    case 'text.delta': {
      const last = chat.items[chat.items.length - 1]
      const items: ViewItem[] =
        last?.kind === 'assistant' && last.streaming
          ? [...chat.items.slice(0, -1), { ...last, text: last.text + event.text }]
          : [...chat.items, { kind: 'assistant', text: event.text, streaming: true }]
      return { ...chat, items, running: true, activity: '' }
    }

    case 'tool.started':
      return {
        ...chat,
        items: [...stopWriting(chat.items), { kind: 'tool', toolId: event.toolId, name: event.name, detail: event.detail, running: true }],
        activity: `Using ${event.name}...`
      }

    case 'tool.finished':
      return {
        ...chat,
        items: chat.items.map(item => (item.kind === 'tool' && item.toolId === event.toolId ? { ...item, running: false, failed: event.failed } : item)),
        activity: 'Thinking...'
      }

    case 'turn.finished': {
      const stopped = event.status === 'stopped'
      const last = chat.items[chat.items.length - 1]
      let items = chat.items
      if (last?.kind === 'assistant' && last.streaming) {
        // The engine repeats the final text. When this page joined mid-reply it only streamed the
        // end of it, so the engine's text wins whenever it contains what was streamed.
        const text = event.text.endsWith(last.text) ? event.text : last.text
        items = [...items.slice(0, -1), { ...last, text, streaming: false, stopped }]
      } else if (event.text) {
        items = [...items, { kind: 'assistant', text: event.text, stopped }]
      } else if (event.status === 'failed') {
        items = [...items, { kind: 'error', text: 'The bot could not finish this reply.' }]
      }
      items = items.map(item => (item.kind === 'tool' && item.running ? { ...item, running: false } : item))
      // Still running when another message is waiting: the engine starts it next.
      return { ...chat, items, running: chat.queued.length > 0, activity: chat.queued.length > 0 ? 'Thinking...' : '' }
    }

    case 'title':
      return { ...chat, title: event.title }

    case 'error':
      return withError(chat, event.message)

    case 'closed':
      return { ...chat, running: false, activity: '' }
  }
}
