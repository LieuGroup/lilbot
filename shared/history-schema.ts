/** Durable conversation rows. Items remain chronological within each newest-first page. */
import type { ChatItem } from './chat-schema'

/** Why LilBot started a session the user did not ask for. */
export type SessionReason = 'not_resumed'

export interface HistoryItem {
  id: string
  sessionId: string
  at: number
  author: 'user' | 'bot' | 'system'
  item: ChatItem | { kind: 'session'; text: 'New session'; reason?: SessionReason }
}
export interface HistoryPage {
  items: HistoryItem[]
  nextCursor: string | null
  /** Only definitive once the background import is complete. */
  start: { at: number } | null
  import: { complete: boolean; sessions: number; completed: number; items: number }
}
