import type { ChatEvent } from '../../shared/chat-schema'
import { applyChatEvent, type ChatView } from '../../shared/client/chat/chat-state'
import type { HistoryPage } from '../../shared/history-schema'

export const play = (chat: ChatView, ...events: ChatEvent[]) => events.reduce(applyChatEvent, chat)
export const texts = (chat: ChatView) =>
  chat.items.map(item =>
    item.kind === 'tool'
      ? `tool:${item.name}`
      : item.kind === 'compaction'
        ? `compaction:${item.summary ?? ''}`
        : item.kind === 'connection.sign_in'
          ? `connection.sign_in:${item.card.serviceName}`
          : `${item.kind}:${item.text}`
  )

/** The `chat.open` answer for the bot's main conversation: the saved history, and its rows without session dividers. */
export const snapshot = (history: HistoryPage) => ({
  chatId: 'main',
  botId: 'b',
  title: '',
  running: false,
  workspace: '',
  items: history.items.flatMap(row => (row.item.kind === 'session' ? [] : [row.item])),
  history
})
