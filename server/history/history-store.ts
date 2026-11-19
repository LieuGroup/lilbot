import type { Database } from 'bun:sqlite'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import type { HistoryItem, HistoryPage } from '../../shared/history-schema'
import { LilBotError } from '../../shared/protocol'

export interface HistorySession {
  bot: string
  id: string
  at: number
  cursor: string | null
  complete: number
}
export interface HistoryRow {
  id: string
  at: number
  order: number
  item: ChatItem
}

/** SQLite owns stable display rows and an event journal written before forwarding each live event. */
export class HistoryStore {
  constructor(readonly db: Database) {}
  session(bot: string, id: string, at: number) {
    this.db.query('INSERT INTO history_sessions(bot,id,at) VALUES(?,?,?) ON CONFLICT(bot,id) DO UPDATE SET at=min(at,excluded.at)').run(bot, id, at)
  }
  sessions(bot: string) {
    return this.db.query('SELECT * FROM history_sessions WHERE bot=? ORDER BY at,id').all(bot) as HistorySession[]
  }
  discovered(bot: string) {
    this.db.query('INSERT OR IGNORE INTO history_imports VALUES(?)').run(bot)
  }
  write(bot: string, session: string, rows: HistoryRow[], cursor?: string | null, complete = false) {
    this.db.transaction(() => {
      const insert = this.db.query(`INSERT INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?,?,?,?)
        ON CONFLICT(bot,id) DO UPDATE SET item=excluded.item,text=excluded.text`)
      for (const row of rows) {
        const text = 'text' in row.item ? row.item.text : ''
        insert.run(bot, session, row.id, row.at, row.order, JSON.stringify(row.item), text)
      }
      if (cursor !== undefined) this.db.query('UPDATE history_sessions SET cursor=?,complete=? WHERE bot=? AND id=?').run(cursor, +complete, bot, session)
    })()
  }
  event(bot: string, session: string, event: ChatEvent, key: string = crypto.randomUUID()) {
    this.db.query('INSERT OR IGNORE INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)').run(bot, session, Date.now(), JSON.stringify(event), key)
  }
  progress(bot: string): HistoryPage['import'] {
    const p = this.db.query('SELECT count(*) sessions,coalesce(sum(complete),0) completed FROM history_sessions WHERE bot=?').get(bot) as { sessions: number; completed: number }
    const { items } = this.db.query('SELECT count(*) items FROM history_items WHERE bot=?').get(bot) as { items: number }
    return { ...p, items, complete: !!this.db.query('SELECT 1 FROM history_imports WHERE bot=?').get(bot) && p.sessions === p.completed }
  }
  page(bot: string, cursor?: string, limit = 100): HistoryPage {
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
    const rows: { session_at: number; session_id: string; id: string; at: number; position: number; item: string }[] = []
    // Seek within each session's index instead of sorting every row across a join.
    for (const session of this.sessions(bot).reverse()) {
      if (key && (session.at > key[0] || (session.at === key[0] && session.id > key[1]))) continue
      const within = key && session.at === key[0] && session.id === key[1] ? key.slice(2) : null
      const page = this.db
        .query(`SELECT id,at,position,item FROM history_items WHERE bot=? AND session=?
        ${within ? 'AND (at,position,id)<(?,?,?)' : ''} ORDER BY at DESC,position DESC,id DESC LIMIT ?`)
        .all(bot, session.id, ...(within ?? []), limit + 1 - rows.length) as { id: string; at: number; position: number; item: string }[]
      rows.push(...page.map(row => ({ ...row, session_at: session.at, session_id: session.id })))
      if (rows.length > limit) break
    }
    const more = rows.length > limit
    rows.length = Math.min(limit, rows.length)
    const last = rows.at(-1)
    const items: HistoryItem[] = rows.reverse().map(row => {
      const item = JSON.parse(row.item)
      return { id: row.id, sessionId: row.session_id, at: row.at, author: item.kind === 'user' ? 'user' : item.kind === 'session' ? 'system' : 'bot', item }
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
  divider(bot: string, session: string, at: number) {
    this.db
      .query(`INSERT OR IGNORE INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?, -1,?, '')`)
      .run(bot, session, `session:${session}`, at, JSON.stringify({ kind: 'session', text: 'New session' }))
  }
  search(bot: string, query: string, limit = 20) {
    const terms = query
      .match(/[\p{L}\p{N}_]+/gu)
      ?.map(t => `"${t}"`)
      .join(' AND ')
    if (!terms) return []
    return this.db
      .query(`SELECT i.id,i.session sessionId,i.at,snippet(history_search,0,'','',' … ',32) snippet FROM history_search f
      JOIN history_items i ON i.rowid=f.rowid WHERE history_search MATCH ? AND i.bot=?
      ORDER BY rank LIMIT ?`)
      .all(terms, bot, limit)
  }
  forget(bot: string) {
    this.db.transaction(() => {
      for (const table of ['history_items', 'history_sessions', 'history_events', 'history_imports']) this.db.query(`DELETE FROM ${table} WHERE bot=?`).run(bot)
    })()
  }
}
