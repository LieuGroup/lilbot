/** The turns of each bot that the after-chat memory review has not looked at yet. A turn is kept
 *  only until it has been reviewed; this is a work queue, not a transcript store. */
import type { Database } from 'bun:sqlite'

/** A long message is cut: a review needs the gist, and memory facts are short anyway. */
const TEXT_LIMIT = 4000

export interface PendingTurn {
  id: number
  chatId: string
  userText: string
  assistantText: string
  createdAt: number
}

export interface PendingSummary {
  botId: string
  turns: number
  lastAt: number
}

const cut = (text: string) => (text.length > TEXT_LIMIT ? `${text.slice(0, TEXT_LIMIT)} [cut]` : text)

export class ReviewQueue {
  constructor(private db: Database) {}

  add(botId: string, chatId: string, userText: string, assistantText: string, at: number) {
    this.db
      .query('INSERT INTO review_turns (bot_id, chat_id, user_text, assistant_text, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(botId, chatId, cut(userText), cut(assistantText), at)
  }

  /** How much is waiting per bot. */
  pending(): PendingSummary[] {
    return this.db.query<PendingSummary, []>('SELECT bot_id AS botId, COUNT(*) AS turns, MAX(created_at) AS lastAt FROM review_turns GROUP BY bot_id').all()
  }

  /** A bot's waiting turns, oldest first, at most `limit`. */
  take(botId: string, limit: number): PendingTurn[] {
    return this.db
      .query<PendingTurn, [string, number]>(
        'SELECT id, chat_id AS chatId, user_text AS userText, assistant_text AS assistantText, created_at AS createdAt FROM review_turns WHERE bot_id = ? ORDER BY id LIMIT ?'
      )
      .all(botId, limit)
  }

  /** Drop the turns a review has covered. */
  done(botId: string, throughId: number) {
    this.db.query('DELETE FROM review_turns WHERE bot_id = ? AND id <= ?').run(botId, throughId)
  }

  forgetBot(botId: string) {
    this.db.query('DELETE FROM review_turns WHERE bot_id = ?').run(botId)
  }
}
