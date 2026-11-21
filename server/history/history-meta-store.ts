/** Durable per-turn usage and compaction token sizes, merged onto imported history rows so they
 *  survive restarts and forced re-imports without altering the engine's stored transcript. */
import type { Database } from 'bun:sqlite'
import type { ChatEvent, ChatItem, CompactionSizes, TurnUsage } from '../../shared/chat-schema'
import type { HistoryRow } from './history-store'

const PENDING_MS = 6 * 60 * 60_000
const CLOCK_SKEW_MS = 5_000
const richness = (usage: TurnUsage) => Object.values(usage).filter(v => v !== undefined).length
const parseUsage = (raw: string): TurnUsage | undefined => {
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as TurnUsage) : undefined
  } catch {
    return undefined
  }
}

export class HistoryMetaStore {
  constructor(private db: Database) {}

  /** Saves live turn usage and compaction sizes from `turn.finished`, patching already-imported rows if they raced ahead. */
  recordTurn(botId: string, sessionId: string, event: Extract<ChatEvent, { type: 'turn.finished' }>, at: number) {
    if (event.usage && richness(event.usage) > 0) this.recordUsage(botId, sessionId, event.usage, event.rowId, event.text.trim(), at)
    if (event.compacted && (event.compacted.beforeTokens !== undefined || event.compacted.afterTokens !== undefined)) {
      this.recordCompaction(botId, sessionId, event.compacted, at)
    }
  }

  /** Attaches saved usage and compaction sizes onto imported rows before `history_items` writes them. */
  mergeRows(botId: string, sessionId: string, rows: HistoryRow[]): HistoryRow[] {
    const merged = rows.map(row => {
      if (row.item.kind === 'assistant' && !row.item.usage) {
        const usage = this.matchUsage(botId, sessionId, row.id, row.item.text.trim(), row.at)
        return usage ? { ...row, item: { ...row.item, usage } } : row
      }
      if (row.item.kind === 'compaction') {
        const sizes = this.matchCompaction(botId, sessionId, row.id, row.at)
        return sizes ? this.withSizes(row, sizes) : row
      }
      return row
    })
    return merged.map((row, index) => (row.item.kind === 'compaction' ? this.fillNeighbors(botId, sessionId, merged, index) : row))
  }

  forget(botId: string) {
    this.db.query('DELETE FROM history_turn_usage WHERE bot_id=?').run(botId)
    this.db.query('DELETE FROM history_compactions WHERE bot_id=?').run(botId)
  }

  private recordUsage(botId: string, sessionId: string, usage: TurnUsage, rowId: string | undefined, text: string, at: number) {
    const encoded = JSON.stringify(usage)
    const insert = 'INSERT OR IGNORE INTO history_turn_usage(id,bot_id,session_id,row_id,text,at,usage) VALUES(?,?,?,?,?,?,?)'
    if (rowId) {
      const existing = this.db.query('SELECT id,usage FROM history_turn_usage WHERE bot_id=? AND row_id=?').get(botId, rowId) as { id: string; usage: string } | null
      if (!existing) this.db.query(insert).run(crypto.randomUUID(), botId, sessionId, rowId, '', at, encoded)
      else if (richness(usage) > richness(parseUsage(existing.usage) ?? {})) this.db.query('UPDATE history_turn_usage SET usage=? WHERE id=?').run(encoded, existing.id)
      return this.patchItem(botId, rowId, item => (item.kind === 'assistant' && (!item.usage || richness(usage) > richness(item.usage)) ? { ...item, usage } : undefined))
    }
    this.db.query('DELETE FROM history_turn_usage WHERE row_id IS NULL AND at < ?').run(at - PENDING_MS)
    const hit = this.db
      .query(
        `SELECT id FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind')='assistant'
         AND json_extract(item,'$.usage') IS NULL AND trim(text)=? AND at>=? AND at<=? ORDER BY at DESC,position DESC LIMIT 1`
      )
      .get(botId, sessionId, text, at - PENDING_MS, at + CLOCK_SKEW_MS) as { id: string } | null
    if (hit) {
      this.db.query(insert).run(crypto.randomUUID(), botId, sessionId, hit.id, '', at, encoded)
      return this.patchItem(botId, hit.id, item => (item.kind === 'assistant' && !item.usage ? { ...item, usage } : undefined))
    }
    this.db.query(insert).run(crypto.randomUUID(), botId, sessionId, null, text, at, encoded)
  }

  private recordCompaction(botId: string, sessionId: string, sizes: CompactionSizes, at: number) {
    this.db.query('DELETE FROM history_compactions WHERE row_id IS NULL AND at < ?').run(at - PENDING_MS)
    const hit = this.db
      .query(
        `SELECT i.id FROM history_items i WHERE i.bot=? AND i.session=? AND json_extract(i.item,'$.kind')='compaction'
         AND NOT EXISTS (SELECT 1 FROM history_compactions c WHERE c.bot_id=i.bot AND c.row_id=i.id)
         AND i.at>=? AND i.at<=? ORDER BY abs(i.at - ?) LIMIT 1`
      )
      .get(botId, sessionId, at - PENDING_MS, at + CLOCK_SKEW_MS, at) as { id: string } | null
    this.db
      .query('INSERT OR IGNORE INTO history_compactions(id,bot_id,session_id,row_id,at,before_tokens,after_tokens) VALUES(?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), botId, sessionId, hit?.id ?? null, at, sizes.beforeTokens ?? null, sizes.afterTokens ?? null)
    if (hit) this.patchItem(botId, hit.id, item => (item.kind === 'compaction' ? this.applySizes(item, sizes) : undefined))
  }

  private matchUsage(botId: string, sessionId: string, rowId: string, text: string, at: number): TurnUsage | undefined {
    type Found = { id: string; usage: string }
    const own = this.db.query('SELECT id,usage FROM history_turn_usage WHERE bot_id=? AND row_id=?').get(botId, rowId) as Found | null
    const found =
      own ??
      (this.db
        .query('SELECT id,usage FROM history_turn_usage WHERE bot_id=? AND session_id=? AND row_id IS NULL AND text=? AND at>=? AND at<=? ORDER BY at,rowid LIMIT 1')
        .get(botId, sessionId, text, at - CLOCK_SKEW_MS, at + PENDING_MS) as Found | null)
    if (!found) return undefined
    if (!own) this.db.query("UPDATE history_turn_usage SET row_id=?,text='' WHERE id=?").run(rowId, found.id)
    return parseUsage(found.usage)
  }

  private matchCompaction(botId: string, sessionId: string, rowId: string, at: number): CompactionSizes | undefined {
    type Found = { id: string; before_tokens: number | null; after_tokens: number | null }
    const own = this.db.query('SELECT id,before_tokens,after_tokens FROM history_compactions WHERE bot_id=? AND row_id=?').get(botId, rowId) as Found | null
    const found =
      own ??
      (this.db
        .query(
          'SELECT id,before_tokens,after_tokens FROM history_compactions WHERE bot_id=? AND session_id=? AND row_id IS NULL AND abs(at - ?)<=? ORDER BY abs(at - ?),rowid LIMIT 1'
        )
        .get(botId, sessionId, at, PENDING_MS, at) as Found | null)
    if (!found) return undefined
    if (!own) this.db.query('UPDATE history_compactions SET row_id=? WHERE id=?').run(rowId, found.id)
    return {
      ...(typeof found.before_tokens === 'number' ? { beforeTokens: found.before_tokens } : {}),
      ...(typeof found.after_tokens === 'number' ? { afterTokens: found.after_tokens } : {})
    }
  }

  private fillNeighbors(botId: string, sessionId: string, rows: HistoryRow[], index: number): HistoryRow {
    const row = rows[index]
    if (row.item.kind !== 'compaction' || (row.item.beforeTokens !== undefined && row.item.afterTokens !== undefined)) return row
    const findCtx = (slice: HistoryRow[]) => slice.find(r => r.item.kind === 'assistant' && r.item.usage?.contextTokens !== undefined)
    const bRow = findCtx(rows.slice(0, index).reverse())
    const aRow = findCtx(rows.slice(index + 1))
    const before = row.item.beforeTokens ?? (bRow?.item.kind === 'assistant' ? bRow.item.usage?.contextTokens : undefined) ?? this.neighborContext(botId, sessionId, row, 'before')
    const after = row.item.afterTokens ?? (aRow?.item.kind === 'assistant' ? aRow.item.usage?.contextTokens : undefined) ?? this.neighborContext(botId, sessionId, row, 'after')
    if (before === undefined || after === undefined || before <= after) return row
    const sizes: CompactionSizes = { beforeTokens: before, afterTokens: after }
    this.db
      .query(
        'INSERT INTO history_compactions(id,bot_id,session_id,row_id,at,before_tokens,after_tokens) VALUES(?,?,?,?,?,?,?) ON CONFLICT(bot_id,row_id) WHERE row_id IS NOT NULL DO UPDATE SET before_tokens=coalesce(before_tokens,excluded.before_tokens), after_tokens=coalesce(after_tokens,excluded.after_tokens)'
      )
      .run(crypto.randomUUID(), botId, sessionId, row.id, row.at, before, after)
    return this.withSizes(row, sizes)
  }

  private neighborContext(botId: string, sessionId: string, row: HistoryRow, dir: 'before' | 'after'): number | undefined {
    const cmp = dir === 'before' ? '<' : '>'
    const sort = dir === 'before' ? 'DESC' : 'ASC'
    const found = this.db
      .query(
        `SELECT json_extract(item,'$.usage.contextTokens') ctx FROM history_items
         WHERE bot=? AND session=? AND json_extract(item,'$.kind')='assistant' AND json_extract(item,'$.usage.contextTokens') IS NOT NULL
         AND (at,position,id) ${cmp} (?,?,?) ORDER BY at ${sort},position ${sort},id ${sort} LIMIT 1`
      )
      .get(botId, sessionId, row.at, row.order, row.id) as { ctx: number } | null
    return typeof found?.ctx === 'number' ? found.ctx : undefined
  }

  private applySizes(item: Extract<ChatItem, { kind: 'compaction' }>, sizes: CompactionSizes) {
    return {
      ...item,
      ...(item.beforeTokens === undefined && sizes.beforeTokens !== undefined ? { beforeTokens: sizes.beforeTokens } : {}),
      ...(item.afterTokens === undefined && sizes.afterTokens !== undefined ? { afterTokens: sizes.afterTokens } : {})
    }
  }

  private withSizes(row: HistoryRow, sizes: CompactionSizes): HistoryRow {
    return row.item.kind === 'compaction' ? { ...row, item: this.applySizes(row.item, sizes) } : row
  }

  private patchItem(botId: string, rowId: string, transform: (item: ChatItem) => ChatItem | undefined) {
    const stored = this.db.query('SELECT item FROM history_items WHERE bot=? AND id=?').get(botId, rowId) as { item: string } | null
    if (!stored) return
    const next = transform(JSON.parse(stored.item) as ChatItem)
    if (next) this.db.query('UPDATE history_items SET item=? WHERE bot=? AND id=?').run(JSON.stringify(next), botId, rowId)
  }
}
