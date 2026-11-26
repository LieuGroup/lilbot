import type { Database } from 'bun:sqlite'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import type { HistoryItem, HistoryPage, SessionReason } from '../../shared/history-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { isShowTool, shownSearchText } from '../../shared/shown-schema'
import { HistoryMetaStore } from './history-meta-store'
import { HistoryPreviewStore } from './history-preview'
import { type HistorySearchMatch, searchHistory } from './history-search'
import { pruneSupersededJournalRows } from './history-tail'

interface HistorySession {
  bot: string
  id: string
  at: number
  cursor: string | null
  complete: number
}
type StoredRow = { id: string; at: number; position: number; item: string }
export interface HistoryRow {
  id: string
  at: number
  order: number
  item: ChatItem
}

/** SQL guard: the row is inserted or counted only while its session is not excluded, atomically with the statement. */
const notExcluded = (bot: string, session: string) => `NOT EXISTS (SELECT 1 FROM history_exclusions x WHERE x.bot=${bot} AND x.session=${session})`

/** SQLite owns stable display rows and an event journal written before forwarding each live event. */
export class HistoryStore {
  readonly meta: HistoryMetaStore
  private previews: HistoryPreviewStore
  constructor(
    readonly db: Database,
    onPreviewChanged?: (botId: string) => void
  ) {
    this.meta = new HistoryMetaStore(db)
    this.previews = new HistoryPreviewStore(db, onPreviewChanged)
  }
  preview = (bot: string) => this.previews.get(bot)
  previewsFor = (bots: readonly string[]) => this.previews.getMany(bots)
  excluded(bot: string, session: string) {
    return !!this.db.query('SELECT 1 FROM history_exclusions WHERE bot=? AND session=?').get(bot, session)
  }
  session(bot: string, id: string, at: number) {
    this.db
      .query(`INSERT INTO history_sessions(bot,id,at) SELECT ?1,?2,?3 WHERE ${notExcluded('?1', '?2')} ON CONFLICT(bot,id) DO UPDATE SET at=min(at,excluded.at)`)
      .run(bot, id, at)
  }
  sessions(bot: string) {
    return this.db.query(`SELECT * FROM history_sessions s WHERE bot=? AND ${notExcluded('s.bot', 's.id')} ORDER BY at,id`).all(bot) as HistorySession[]
  }
  discovered(bot: string) {
    this.db.query('INSERT OR IGNORE INTO history_imports VALUES(?)').run(bot)
  }
  writeUnchecked(bot: string, session: string, rows: HistoryRow[], cursor?: string | null, complete = false): boolean {
    // Checked under the write lock, so an exclusion committed meanwhile is never undone by a late page.
    if (this.excluded(bot, session)) return false
    const enriched = this.meta.mergeRows(bot, session, rows)
    pruneSupersededJournalRows(this.db, bot, session, enriched)
    const insert = this.db.query(`INSERT INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(bot,id) DO UPDATE SET item=excluded.item,text=excluded.text`)
    for (const row of enriched) {
      if (row.item.kind === 'tool' && isShowTool(row.item.name)) continue
      const text = 'text' in row.item ? row.item.text : row.item.kind === 'shown' ? shownSearchText(row.item.file) : ''
      insert.run(bot, session, row.id, row.at, row.order, JSON.stringify(row.item), text)
    }
    if (cursor !== undefined) this.db.query('UPDATE history_sessions SET cursor=?,complete=? WHERE bot=? AND id=?').run(cursor, +complete, bot, session)
    return enriched.some(row => row.item.kind === 'user' || row.item.kind === 'assistant') ? this.previews.backfillIfMissing(bot) : false
  }
  write(bot: string, session: string, rows: HistoryRow[], cursor?: string | null, complete = false) {
    const changed = this.db.transaction(() => this.writeUnchecked(bot, session, rows, cursor, complete)).immediate()
    this.previews.afterWriteCommit(bot, changed)
  }
  event(bot: string, session: string, event: ChatEvent, key: string = crypto.randomUUID()) {
    const now = Date.now()
    const res = this.db
      .transaction(() => {
        const inserted = this.db
          .query(`INSERT OR IGNORE INTO history_events(bot,session,at,event,key) SELECT ?1,?2,?3,?4,?5 WHERE ${notExcluded('?1', '?2')}`)
          .run(bot, session, now, JSON.stringify(event), key)
        const out = inserted.changes > 0 ? this.previews.recordEvent(bot, session, event, now) : { changed: false }
        if (event.type === 'turn.finished' && !this.excluded(bot, session)) this.meta.recordTurn(bot, session, event, now)
        return out
      })
      .immediate()
    this.previews.afterEventCommit(bot, res.changed, res.turnId)
  }
  progress(bot: string): HistoryPage['import'] {
    const p = this.db.query(`SELECT count(*) sessions,coalesce(sum(complete),0) completed FROM history_sessions s WHERE bot=? AND ${notExcluded('s.bot', 's.id')}`).get(bot) as {
      sessions: number
      completed: number
    }
    const { items } = this.db.query(`SELECT count(*) items FROM history_items i WHERE bot=? AND ${notExcluded('i.bot', 'i.session')}`).get(bot) as { items: number }
    return { ...p, items, complete: !!this.db.query('SELECT 1 FROM history_imports WHERE bot=?').get(bot) && p.sessions === p.completed }
  }
  /** `main` is the bot's main session: its divider shows while it is still empty (just after New session). */
  page(bot: string, cursor?: string, limit = 100, main?: string | null): HistoryPage {
    // Cursor holds the immutable session sort key and row position, never a mutable offset.
    let key: [number, string, number, number, string] | null = null
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString())
        if (
          value[0] !== bot ||
          value.length !== 6 ||
          !Number.isFinite(value[1]) ||
          typeof value[2] !== 'string' ||
          !Number.isFinite(value[3]) ||
          !Number.isFinite(value[4]) ||
          typeof value[5] !== 'string'
        )
          throw 0
        key = value.slice(1)
      } catch {
        throw new LilBotError('invalid_cursor', 'This history cursor is invalid for this bot.')
      }
    }
    const rows: (StoredRow & { session_at: number; session_id: string })[] = []
    // A session without a user or assistant message (another client's empty session, one left behind) shows no
    // divider. Decided here, when the page is built, so stored and re-imported rows follow the same rule.
    const spoken = this.db.query(
      `SELECT 1 FROM history_items WHERE bot=? AND session=? AND (json_extract(item,'$.kind') IN ('user','assistant') OR json_extract(item,'$.reason')='engine_switched_gap') LIMIT 1`
    )
    // Seek within each session's index instead of sorting every row across a join.
    for (const session of this.sessions(bot).reverse()) {
      if (key && (session.at > key[0] || (session.at === key[0] && session.id > key[1]))) continue
      const within = key && session.at === key[0] && session.id === key[1] ? key.slice(2) : null
      const silent = session.id !== main && !spoken.get(bot, session.id)
      const page = this.db
        .query(`SELECT id,at,position,item FROM history_items WHERE bot=? AND session=? ${silent ? 'AND id<>?' : ''}
        ${within ? 'AND (at,position,id)<(?,?,?)' : ''} ORDER BY at DESC,position DESC,id DESC LIMIT ?`)
        .all(bot, session.id, ...(silent ? [`session:${session.id}`] : []), ...(within ?? []), limit + 1 - rows.length) as StoredRow[]
      rows.push(...page.map(row => ({ ...row, session_at: session.at, session_id: session.id })))
      if (rows.length > limit) break
    }
    const more = rows.length > limit
    rows.length = Math.min(limit, rows.length)
    const last = rows.at(-1)
    const items: HistoryItem[] = rows.reverse().map(row => {
      const item = JSON.parse(row.item)
      const author = item.kind === 'user' ? 'user' : item.kind === 'session' || item.kind === 'compaction' || item.kind === 'connection.sign_in' ? 'system' : 'bot'
      return { id: row.id, sessionId: row.session_id, at: row.at, author, item }
    })
    const progress = this.progress(bot)
    return {
      items,
      nextCursor: more && last ? Buffer.from(JSON.stringify([bot, last.session_at, last.session_id, last.at, last.position, last.id])).toString('base64url') : null,
      start: !more && progress.complete && this.sessions(bot).length ? { at: this.sessions(bot)[0].at } : null,
      import: progress
    }
  }
  reference(bot: string, session: string, item: Extract<ChatItem, { kind: 'tool' }>, at: number) {
    this.write(bot, session, [{ id: item.toolId, at, order: 0, item }])
  }
  hasItem(id: string): boolean {
    return Boolean(this.db.query('SELECT 1 FROM history_items WHERE id=? LIMIT 1').get(id))
  }
  /** Inserts or updates a service sign-in card in place in its conversation; never indexed in FTS (`text` stays empty). */
  signInCard(bot: string, session: string, card: import('../../shared/connections-schema').ConnectionSignInCard) {
    this.session(bot, session, card.createdAt)
    this.write(bot, session, [{ id: `sign_in:${card.id}`, at: card.createdAt, order: 0, item: { kind: 'connection.sign_in', card } }])
  }
  /** Where a session began. A reason (given only while opening) replaces a plain divider discovery drew a moment earlier. */
  divider(bot: string, session: string, at: number, reason?: SessionReason) {
    this.db
      .query(`INSERT INTO history_items(bot,session,id,at,position,item,text) SELECT ?1,?2,?3,?4,-1,?5,'' WHERE ${notExcluded('?1', '?2')}
      ON CONFLICT(bot,id) DO ${reason ? 'UPDATE SET item=excluded.item' : 'NOTHING'}`)
      .run(bot, session, `session:${session}`, at, JSON.stringify({ kind: 'session', text: 'New session', ...(reason ? { reason } : {}) }))
  }
  search(bot: string, query: string, limit = 20, allow?: (sessionId: string) => boolean): HistorySearchMatch[] {
    return searchHistory(this.db, bot, query, limit, allow)
  }
  /** Whether Oscar sent a visible user message in `(bot, session)` containing `needle`. Hidden prompts, tool output and assistant turns never match. */
  hasUserMessageContaining(bot: string, session: string, needle: string): boolean {
    if (!needle) return false
    const inEvents = this.db
      .query(`SELECT 1 FROM history_events WHERE bot=? AND session=? AND json_extract(event,'$.type')='user.message' AND instr(json_extract(event,'$.text'),?)>0 LIMIT 1`)
      .get(bot, session, needle)
    if (inEvents) return true
    return !!this.db.query(`SELECT 1 FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind')='user' AND instr(text,?)>0 LIMIT 1`).get(bot, session, needle)
  }
  /** Marks old sessions for a bot complete (excluding any sessions already belonging to the target engine). */
  sealSessions(bot: string, exclude?: ReadonlySet<string>) {
    if (!exclude?.size) {
      this.db.query('UPDATE history_sessions SET complete=1 WHERE bot=?').run(bot)
      return
    }
    const mark = this.db.query('UPDATE history_sessions SET complete=1 WHERE bot=? AND id=?')
    for (const session of this.sessions(bot)) if (!exclude.has(session.id)) mark.run(bot, session.id)
  }
  forget(bot: string) {
    this.db.transaction(() => {
      for (const table of ['history_items', 'history_sessions', 'history_events', 'history_imports', 'history_exclusions', 'history_previews'])
        this.db.query(`DELETE FROM ${table} WHERE bot=?`).run(bot)
      this.meta.forget(bot)
    })()
    this.previews.forget(bot)
  }
}
