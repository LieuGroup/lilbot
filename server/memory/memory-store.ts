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
  learned_at: number
  forgotten_at: number | null
}

const factFrom = (row: FactRow): MemoryFact => ({
  id: row.id,
  botId: row.bot_id,
  kind: row.kind,
  scope: row.scope,
  text: row.text,
  author: row.author,
  learnedAt: row.learned_at,
  forgottenAt: row.forgotten_at
})

/** Active facts a bot can see: its own, and everything shared. */
const VISIBLE = `forgotten_at IS NULL AND (scope = 'shared' OR bot_id = $botId)`

export class MemoryStore {
  constructor(private db: Database) {}

  insert(fact: Omit<MemoryFact, 'forgottenAt'>) {
    this.db
      .query('INSERT INTO memory_facts (id, bot_id, kind, scope, text, author, learned_at) VALUES ($id, $botId, $kind, $scope, $text, $author, $learnedAt)')
      .run({ id: fact.id, botId: fact.botId, kind: fact.kind, scope: fact.scope, text: fact.text, author: fact.author, learnedAt: fact.learnedAt })
  }

  get(factId: string): MemoryFact | null {
    const row = this.db.query<FactRow, [string]>('SELECT * FROM memory_facts WHERE id = ?').get(factId)
    return row ? factFrom(row) : null
  }

  /** Newest first. `kind` and `limit` narrow it. */
  visible(botId: string, options: { kind?: MemoryKind; limit?: number } = {}): MemoryFact[] {
    return this.db
      .query<FactRow, { botId: string; kind: string | null; limit: number }>(
        `SELECT * FROM memory_facts WHERE ${VISIBLE} AND ($kind IS NULL OR kind = $kind) ORDER BY learned_at DESC, rowid DESC LIMIT $limit`
      )
      .all({ botId, kind: options.kind ?? null, limit: options.limit ?? 1000 })
      .map(factFrom)
  }

  /** An active fact the bot can see with exactly this text, if any. */
  findSame(botId: string, kind: MemoryKind, text: string): MemoryFact | null {
    const row = this.db
      .query<FactRow, { botId: string; kind: string; text: string }>(`SELECT * FROM memory_facts WHERE ${VISIBLE} AND kind = $kind AND text = $text COLLATE NOCASE LIMIT 1`)
      .get({ botId, kind, text })
    return row ? factFrom(row) : null
  }

  /** Visible facts whose id starts with `prefix`; bots refer to facts by a short id. */
  byIdPrefix(botId: string, prefix: string): MemoryFact[] {
    return this.db
      .query<FactRow, { botId: string; prefix: string }>(`SELECT * FROM memory_facts WHERE ${VISIBLE} AND id LIKE $prefix || '%' LIMIT 2`)
      .all({ botId, prefix })
      .map(factFrom)
  }

  /** Full-text search over visible facts, best match first. `match` is an FTS5 query. */
  search(botId: string, match: string, options: { kind?: MemoryKind; limit: number }): MemoryFact[] {
    return this.db
      .query<FactRow, { botId: string; match: string; kind: string | null; limit: number }>(
        `SELECT memory_facts.* FROM memory_search JOIN memory_facts ON memory_facts.rowid = memory_search.rowid
         WHERE memory_search MATCH $match AND ${VISIBLE} AND ($kind IS NULL OR kind = $kind)
         ORDER BY bm25(memory_search), learned_at DESC LIMIT $limit`
      )
      .all({ botId, match, kind: options.kind ?? null, limit: options.limit })
      .map(factFrom)
  }

  markForgotten(factId: string, at: number): boolean {
    return this.db.query('UPDATE memory_facts SET forgotten_at = ? WHERE id = ? AND forgotten_at IS NULL').run(at, factId).changes > 0
  }

  /** A bot was deleted: its private facts go with it; what it shared stays for the other bots. */
  dropPrivate(botId: string) {
    this.db.query("DELETE FROM memory_facts WHERE bot_id = ? AND scope = 'bot'").run(botId)
  }
}
