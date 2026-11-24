/** Durable record of memory-review and pre-compress checkpoint sessions. Persisted in SQLite so review sessions
 *  and their compression continuations stay excluded from history, re-review queueing, and skill writes across restarts. */
import type { Database } from 'bun:sqlite'

const RETENTION_MS = 7 * 86_400_000
const REVIEW_MUTATION_REFUSAL = 'This session is a memory review: it may only recall, save, or forget memory, nothing else.'

export interface ReviewSessionLookup {
  record(botId: string, chatId: string, at?: number): void
  has(chatId: string): boolean
  forgetBot(botId: string): void
}

export class ReviewSessionStore implements ReviewSessionLookup {
  constructor(private db: Database) {}

  record(botId: string, chatId: string, at = Date.now()) {
    this.db.query('INSERT OR IGNORE INTO review_sessions (chat_id, bot_id, created_at) VALUES (?, ?, ?)').run(chatId, botId, at)
    this.db.query('DELETE FROM review_sessions WHERE created_at < ?').run(at - RETENTION_MS)
  }

  has(chatId: string): boolean {
    return this.db.query('SELECT 1 FROM review_sessions WHERE chat_id = ?').get(chatId) !== null
  }

  forgetBot(botId: string) {
    this.db.query('DELETE FROM review_sessions WHERE bot_id = ?').run(botId)
  }
}

export function inMemoryReviewSessionStore(): ReviewSessionLookup {
  const chats = new Map<string, string>()
  return {
    record: (botId, chatId) => void chats.set(chatId, botId),
    has: chatId => chats.has(chatId),
    forgetBot: botId => {
      for (const [chatId, owner] of chats) if (owner === botId) chats.delete(chatId)
    }
  }
}

/** Fail-closed review-session check for engine API routes (such as `/engine/skills/write`): traces compression
 *  lineage back to its root and refuses when lineage is unreadable or absent while a review of `botId` is running. */
export function reviewSessionRefusal(store: Pick<ReviewSessionLookup, 'has'>, rootOf: (botId: string, chatId: string) => string | null, reviewing: (botId: string) => boolean) {
  const isReview = (botId: string, chatId: string): boolean => {
    if (store.has(chatId)) return true
    const root = rootOf(botId, chatId)
    if (root === null) return reviewing(botId)
    return root !== chatId && store.has(root)
  }
  return (botId: string, chatId: string | undefined): string | null => {
    if (chatId ? isReview(botId, chatId) : reviewing(botId)) return REVIEW_MUTATION_REFUSAL
    return null
  }
}
