/** What a chat looks like on screen, and how each live event changes it. Pure functions only. */
import type { ChatEvent, ChatItem, ChatSnapshot } from '../../../shared/chat-schema'
import type { HistoryPage, SessionReason } from '../../../shared/history-schema'
import { reuseItems, withLatest } from '../history/history-view'
import { withArrivedMessage } from './user-messages'

/** Where a new session began, inside the one continuous conversation. */
type SessionMark = { kind: 'session'; text: string; reason?: SessionReason }
/** `streaming` marks the assistant message that is still being written. Items from the saved
 *  history carry its row `id` and time `at`. */
export type ViewItem = (ChatItem | SessionMark) & { streaming?: boolean; id?: string; at?: number }
/** Everything in the conversation except the session dividers. */
export type MessageItem = Exclude<ViewItem, SessionMark>
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
  /** Where the running turn's output begins, when it started with no message on screen: a message from
   *  another device whose event comes after its turn started goes there. */
  bareTurn: number | null
  running: boolean
  activity: string
  title: string
  /** Counts the times the transcript came from the server rather than from a live event. */
  load: number
  /** The position of `items[0]` in the conversation. Earlier parts go before it with lower
   *  positions, so every row keeps its position (its key) as the list grows at either end. */
  first: number
  /** The cursor for the next earlier part of the history; null when none is known. */
  older: string | null
  /** The cursor that fetched the earliest part on screen (null: the latest part). */
  oldestFrom: string | null
  /** When the conversation started. Known once its very first part is on screen. */
  start: number | null
  /** The history is still being imported, so earlier rows may yet appear. */
  importing: boolean
}

export const emptyChat: ChatView = {
  chatId: '',
  items: [],
  queued: [],
  awaitingStart: false,
  bareTurn: null,
  running: false,
  activity: '',
  title: '',
  load: 0,
  first: 0,
  older: null,
  oldestFrom: null,
  start: null,
  importing: false
}

/** The open chat. The bot's main conversation comes with its saved history (with session
 *  dividers); any other chat has only its own transcript. */
export function chatFromSnapshot(snapshot: ChatSnapshot, previous: ChatView = emptyChat): ChatView {
  const history = snapshot.history
    ? withLatest(previous, snapshot.history)
    : { items: reuseItems(previous.items, snapshot.items), first: previous.first, older: null, oldestFrom: null, start: null, importing: false }
  return {
    ...history,
    chatId: snapshot.chatId,
    queued: [],
    awaitingStart: false,
    bareTurn: null,
    running: snapshot.running,
    activity: snapshot.running ? 'Working...' : '',
    title: snapshot.title,
    load: previous.load + 1
  }
}

/** The bot's saved conversation, shown while its chat is still opening. Nothing can be sent yet;
 *  the chat's own snapshot replaces it moments later. The latest record names the main session. */
export function chatFromHistory(page: HistoryPage, previous: ChatView = emptyChat): ChatView {
  return { ...emptyChat, ...withLatest(previous, page), chatId: page.items.at(-1)?.sessionId ?? '', load: previous.load + 1 }
}

/** "New session" adds a divider at once; the new session's snapshot then confirms it. The
 *  conversation above stays. */
export function withNewSession(chat: ChatView): ChatView {
  const items: ViewItem[] = chat.items.length > 0 ? [...stopWriting(chat.items), { kind: 'session', text: 'New session' }] : chat.items
  return { ...chat, items, queued: [], awaitingStart: false, bareTurn: null, running: false, activity: '' }
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
      return withArrivedMessage(chat, message)
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
      if (next === undefined) return { ...chat, bareTurn: chat.items.length, running: true, activity: 'Thinking...' }
      return { ...chat, items: [...stopWriting(chat.items), next], queued: rest, running: true, activity: 'Thinking...' }
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
      return { ...chat, items, bareTurn: null, running: chat.queued.length > 0, activity: chat.queued.length > 0 ? 'Thinking...' : '' }
    }

    case 'title':
      return { ...chat, title: event.title }

    case 'error':
      return withError(chat, event.message)

    case 'closed':
      return { ...chat, running: false, activity: '' }
  }
}
