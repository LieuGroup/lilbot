/** All SQL for memory facts. Rules about what a bot may see or do live in `memory-service.ts`. */
import type { Database } from 'bun:sqlite'

import type { MemoryFact, MemoryKind, MemoryScope } from '../../shared/memory-schema'

interface FactRow {
  id: string
  bot_id: string
  kind: MemoryKind
  scope: MemoryScope
  text: string
  author: 'bot' | 'user'
  via: MemoryFact['via']
  learned_at: number
  paused: number
  expires_at: number | null
  forgotten_at: number | null
  forgotten_by: 'bot' | 'user' | null
}

const factFrom = (row: FactRow): MemoryFact => ({
  id: row.id,
  botId: row.bot_id,
  kind: row.kind,
  scope: row.scope,
  text: row.text,
  author: row.author,
  via: row.via,
  learnedAt: row.learned_at,
  paused: row.paused === 1,
  expiresAt: row.expires_at,
  forgottenAt: row.forgotten_at
})

/** Facts that belong to a bot's memory at all: its own, and everything shared. */
const MINE = `(scope = 'shared' OR bot_id = $botId)`
/** Of those, the ones a bot is shown and can recall: not forgotten, not paused, not expired. */
const VISIBLE = `forgotten_at IS NULL AND paused = 0 AND (expires_at IS NULL OR expires_at > $now) AND ${MINE}`

export interface NewFact {
  id: string
  botId: string
  kind: MemoryKind
  scope: MemoryScope
  text: string
  author: 'bot' | 'user'
  via: MemoryFact['via']
  learnedAt: number
  sourceChatId: string | null
  expiresAt: number | null
}

export class MemoryStore {
  constructor(private db: Database) {}

  insert(fact: NewFact) {
    this.db
      .query(
        `INSERT INTO memory_facts (id, bot_id, kind, scope, text, author, via, learned_at, source_chat_id, expires_at)
         VALUES ($id, $botId, $kind, $scope, $text, $author, $via, $learnedAt, $sourceChatId, $expiresAt)`
      )
      .run({ ...fact })
  }

  /** What a bot is shown and can recall, newest first. `kind` and `limit` narrow it. */
  visible(botId: string, now: number, options: { kind?: MemoryKind; limit?: number } = {}): MemoryFact[] {
    return this.db
      .query<FactRow, { botId: string; now: number; kind: string | null; limit: number }>(
        `SELECT * FROM memory_facts WHERE ${VISIBLE} AND ($kind IS NULL OR kind = $kind) ORDER BY learned_at DESC, rowid DESC LIMIT $limit`
      )
      .all({ botId, now, kind: options.kind ?? null, limit: options.limit ?? 1000 })
      .map(factFrom)
  }

  /** Everything in a bot's memory that is not forgotten, paused and expired facts included: for the app. */
  kept(botId: string): MemoryFact[] {
    return this.db
      .query<FactRow, { botId: string }>(`SELECT * FROM memory_facts WHERE forgotten_at IS NULL AND ${MINE} ORDER BY learned_at DESC, rowid DESC`)
      .all({ botId })
      .map(factFrom)
  }

  /** The most recently forgotten facts of a bot's memory, for restoring them. */
  forgotten(botId: string, limit: number): MemoryFact[] {
    return this.db
      .query<FactRow, { botId: string; limit: number }>(`SELECT * FROM memory_facts WHERE forgotten_at IS NOT NULL AND ${MINE} ORDER BY forgotten_at DESC LIMIT $limit`)
      .all({ botId, limit })
      .map(factFrom)
  }

  /** A fact with exactly this text that the bot still has (paused ones count: it is known). */
  findSame(botId: string, kind: MemoryKind, text: string): MemoryFact | null {
    const row = this.db
      .query<FactRow, { botId: string; kind: string; text: string }>(
        `SELECT * FROM memory_facts WHERE forgotten_at IS NULL AND ${MINE} AND kind = $kind AND text = $text COLLATE NOCASE LIMIT 1`
      )
      .get({ botId, kind, text })
    return row ? factFrom(row) : null
  }

  /** Whether the user removed a fact with exactly this text from this bot's memory. */
  userForgot(botId: string, text: string): boolean {
    return (
      this.db
        .query<{ found: number }, { botId: string; text: string }>(
          `SELECT 1 AS found FROM memory_facts WHERE forgotten_at IS NOT NULL AND forgotten_by = 'user' AND ${MINE} AND text = $text COLLATE NOCASE LIMIT 1`
        )
        .get({ botId, text }) !== null
    )
  }

  /** Visible facts whose id starts with `prefix`; bots refer to facts by a short id. */
  byIdPrefix(botId: string, now: number, prefix: string): MemoryFact[] {
    return this.db
      .query<FactRow, { botId: string; now: number; prefix: string }>(`SELECT * FROM memory_facts WHERE ${VISIBLE} AND id LIKE $prefix || '%' LIMIT 2`)
      .all({ botId, now, prefix })
      .map(factFrom)
  }

  /** Full-text search over visible facts, best match first. `match` is an FTS5 query. */
  search(botId: string, now: number, match: string, options: { kind?: MemoryKind; limit: number }): MemoryFact[] {
    return this.db
      .query<FactRow, { botId: string; now: number; match: string; kind: string | null; limit: number }>(
        `SELECT memory_facts.* FROM memory_search JOIN memory_facts ON memory_facts.rowid = memory_search.rowid
         WHERE memory_search MATCH $match AND ${VISIBLE} AND ($kind IS NULL OR kind = $kind)
         ORDER BY bm25(memory_search), learned_at DESC LIMIT $limit`
      )
      .all({ botId, now, match, kind: options.kind ?? null, limit: options.limit })
      .map(factFrom)
  }

  markForgotten(factId: string, at: number, by: 'bot' | 'user'): boolean {
    return this.db.query('UPDATE memory_facts SET forgotten_at = ?, forgotten_by = ? WHERE id = ? AND forgotten_at IS NULL').run(at, by, factId).changes > 0
  }

  restore(factId: string): boolean {
    return this.db.query('UPDATE memory_facts SET forgotten_at = NULL, forgotten_by = NULL WHERE id = ? AND forgotten_at IS NOT NULL').run(factId).changes > 0
  }

  setPaused(factId: string, paused: boolean): boolean {
    return this.db.query('UPDATE memory_facts SET paused = ? WHERE id = ? AND forgotten_at IS NULL').run(paused ? 1 : 0, factId).changes > 0
  }

  setExpiry(factId: string, expiresAt: number | null): boolean {
    return this.db.query('UPDATE memory_facts SET expires_at = ? WHERE id = ? AND forgotten_at IS NULL').run(expiresAt, factId).changes > 0
  }

  /** Deletion is user-directed forgetting, never erasure; shared facts remain unchanged. */
  forgetPrivate(botId: string, at: number) {
    this.db.query("UPDATE memory_facts SET forgotten_at = ?, forgotten_by = 'user' WHERE bot_id = ? AND scope = 'bot' AND forgotten_at IS NULL").run(at, botId)
  }
}
