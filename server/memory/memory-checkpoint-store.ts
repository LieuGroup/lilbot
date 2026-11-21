/** Durable record of which conversation pieces each bot has already reviewed for memory before compaction (#198).
 *  Bounded to `REMEMBERED` rows by pruning the oldest reviewed entries first, so restarts and deploys do not force
 *  a full re-review while the table stays small. */
import type { Database } from 'bun:sqlite'

const REMEMBERED = 50_000

export interface CheckpointStore {
  has(botId: string, key: string): boolean
  record(botId: string, keys: readonly string[], now?: number): void
  forgetBot(botId: string): void
}

export class MemoryCheckpointStore implements CheckpointStore {
  constructor(
    private db: Database,
    private limit = REMEMBERED
  ) {}

  has(botId: string, key: string): boolean {
    return this.db.query('SELECT 1 FROM memory_checkpoint_reviewed WHERE bot_id = ? AND piece_key = ?').get(botId, key) !== null
  }

  record(botId: string, keys: readonly string[], now = Date.now()) {
    if (!keys.length) return
    const upsert = this.db.query(
      'INSERT INTO memory_checkpoint_reviewed (bot_id, piece_key, reviewed_at) VALUES (?, ?, ?) ON CONFLICT(bot_id, piece_key) DO UPDATE SET reviewed_at = excluded.reviewed_at'
    )
    this.db.transaction(() => {
      for (const key of keys) upsert.run(botId, key, now)
      const { count } = this.db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM memory_checkpoint_reviewed').get()!
      if (count > this.limit) {
        this.db
          .query('DELETE FROM memory_checkpoint_reviewed WHERE rowid IN (SELECT rowid FROM memory_checkpoint_reviewed ORDER BY reviewed_at ASC, rowid ASC LIMIT ?)')
          .run(count - this.limit)
      }
    })()
  }

  forgetBot(botId: string) {
    this.db.query('DELETE FROM memory_checkpoint_reviewed WHERE bot_id = ?').run(botId)
  }
}

export function inMemoryCheckpointStore(limit = REMEMBERED): CheckpointStore {
  const reviewed = new Set<string>()
  return {
    has: (botId, key) => reviewed.has(`${botId}\n${key}`),
    record: (botId, keys) => {
      for (const key of keys) {
        const entry = `${botId}\n${key}`
        reviewed.delete(entry)
        reviewed.add(entry)
      }
      while (reviewed.size > limit) {
        const oldest = reviewed.values().next().value
        if (oldest === undefined) break
        reviewed.delete(oldest)
      }
    },
    forgetBot: botId => {
      const prefix = `${botId}\n`
      for (const entry of reviewed) if (entry.startsWith(prefix)) reviewed.delete(entry)
    }
  }
}
