/** SQLite query and watermark helpers for `HistoryPreviewCache`.
 *  Reconciles `history_items` and `history_events` using `history_preview_marks` rowid position and exact row/message IDs only. */
import type { Database } from 'bun:sqlite'
import type { BotLastMessage } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { eventCandidate, type PersistedPreview, persistedRowPreview, type SourcedPreview } from './history-preview-text'

const NOT_EXCLUDED = (bot: string, session: string) => `NOT EXISTS (SELECT 1 FROM history_exclusions x WHERE x.bot=${bot} AND x.session=${session})`

export type ItemState = { latest: SourcedPreview; messageIds: Set<string>; olderSessions: Set<string> }
export type PreviewState = { preview: BotLastMessage | null; session?: string; messageIds?: Set<string>; olderSessions?: Set<string> }

/** O(1) current `history_events` high-water mark, captured before async engine reads so concurrent sends stay ahead. */
export function eventWatermark(db: Database): number {
  const row = db.query('SELECT COALESCE(MAX(rowid), 0) AS m FROM history_events').get() as { m: number } | null
  return row?.m ?? 0
}

export const hasStoredItem = (db: Database, bot: string, id: string) => Boolean(db.query('SELECT 1 FROM history_items WHERE bot=? AND id=? LIMIT 1').get(bot, id))

/** Advances the durable per-session watermark when `history_items` gains a new newest visible row (never on older backfills). */
export function recordWriteMark(db: Database, bot: string, session: string, eventMark?: number) {
  const rows = db
    .query(
      `SELECT id, at, item FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind') IN ('user','assistant')
       ORDER BY at DESC, position DESC, id DESC LIMIT 20`
    )
    .all(bot, session) as { id: string; at: number; item: string }[]
  let top: PersistedPreview | null = null
  for (const row of rows) {
    top = persistedRowPreview(row)
    if (top) break
  }
  if (!top?.id) return
  const prev = db.query('SELECT event_rowid, latest_id FROM history_preview_marks WHERE bot=? AND session=?').get(bot, session) as { event_rowid: number; latest_id: string } | null
  if (prev?.latest_id === top.id) return
  let wm = eventMark ?? eventWatermark(db)
  const recent = db
    .query(
      `SELECT rowid, session, at, event FROM history_events
       WHERE bot=? AND rowid > ? AND json_extract(event,'$.type') IN ('user.message','turn.finished')
       ORDER BY rowid DESC LIMIT 10`
    )
    .all(bot, prev?.event_rowid ?? 0) as { rowid: number; session: string; at: number; event: string }[]
  for (const row of recent) {
    if (row.session !== session) continue
    try {
      const candidate = eventCandidate(JSON.parse(row.event) as ChatEvent, row.at, row.session)
      const matched = candidate && ((top.id && candidate.id === top.id) || (top.messageId && candidate.messageId === top.messageId))
      if (matched) {
        wm = Math.min(wm, row.rowid)
        break
      }
    } catch {}
  }
  db.query(
    `INSERT INTO history_preview_marks(bot, session, event_rowid, latest_id) VALUES(?, ?, ?, ?)
     ON CONFLICT(bot, session) DO UPDATE SET event_rowid=MAX(event_rowid, excluded.event_rowid), latest_id=excluded.latest_id`
  ).run(bot, session, wm, top.id)
}

export function latestItemPreview(db: Database, bot: string): ItemState | null {
  const sessions = db.query(`SELECT id FROM history_sessions s WHERE bot=? AND ${NOT_EXCLUDED('s.bot', 's.id')} ORDER BY at DESC, id DESC`).all(bot) as { id: string }[]
  const firstBatch = db.query(
    `SELECT id, at, position, item FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind') IN ('user','assistant')
     ORDER BY at DESC, position DESC, id DESC LIMIT 20`
  )
  const nextBatch = db.query(
    `SELECT id, at, position, item FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind') IN ('user','assistant')
     AND (at, position, id) < (?, ?, ?) ORDER BY at DESC, position DESC, id DESC LIMIT 20`
  )
  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i]
    let rows = firstBatch.all(bot, session.id) as { id: string; at: number; position: number; item: string }[]
    while (rows.length) {
      const parsed = rows.map(persistedRowPreview).filter((p): p is PersistedPreview => p !== null)
      if (parsed.length) {
        const messageIds = new Set(parsed.map(p => p.messageId).filter((m): m is string => Boolean(m)))
        return { latest: { ...parsed[0], session: session.id }, messageIds, olderSessions: new Set(sessions.slice(i + 1).map(s => s.id)) }
      }
      if (rows.length < 20) break
      const last = rows.at(-1)!
      rows = nextBatch.all(bot, session.id, last.at, last.position, last.id) as { id: string; at: number; position: number; item: string }[]
    }
  }
  const unindexed = db
    .query(
      `SELECT id, session, at, item FROM history_items i WHERE bot=? AND json_extract(item,'$.kind') IN ('user','assistant') AND ${NOT_EXCLUDED('i.bot', 'i.session')}
       ORDER BY at DESC, position DESC, id DESC LIMIT 20`
    )
    .all(bot) as { id: string; session: string; at: number; item: string }[]
  const parsed: PersistedPreview[] = []
  let session: string | null = null
  for (const row of unindexed) {
    const entry = persistedRowPreview(row)
    if (!entry) continue
    if (session === null) session = row.session
    if (row.session === session) parsed.push(entry)
  }
  if (!session || !parsed.length) return null
  const messageIds = new Set(parsed.map(p => p.messageId).filter((m): m is string => Boolean(m)))
  return { latest: { ...parsed[0], session }, messageIds, olderSessions: new Set() }
}

function latestEventPreview(db: Database, bot: string, afterRowid: number, minAt: number, skip: (c: SourcedPreview) => boolean): SourcedPreview | null {
  const first = db.query(
    `SELECT rowid, session, at, event FROM history_events e
     WHERE bot=? AND rowid > ? AND at > ? AND json_extract(event,'$.type') IN ('user.message','turn.finished') AND ${NOT_EXCLUDED('e.bot', 'e.session')}
     ORDER BY rowid DESC LIMIT 1`
  )
  const next = db.query(
    `SELECT rowid, session, at, event FROM history_events e
     WHERE bot=? AND rowid > ? AND rowid < ? AND at > ? AND json_extract(event,'$.type') IN ('user.message','turn.finished') AND ${NOT_EXCLUDED('e.bot', 'e.session')}
     ORDER BY rowid DESC LIMIT 5`
  )
  const head = first.get(bot, afterRowid, minAt) as { rowid: number; session: string; at: number; event: string } | null
  if (!head) return null
  let rows = [head]
  while (rows.length) {
    for (const row of rows) {
      try {
        const candidate = eventCandidate(JSON.parse(row.event) as ChatEvent, row.at, row.session)
        if (candidate && !skip(candidate)) return candidate
      } catch {}
    }
    const last = rows.at(-1)!
    rows = next.all(bot, afterRowid, last.rowid, minAt) as { rowid: number; session: string; at: number; event: string }[]
  }
  return null
}

/** Computes a bot's preview from SQLite using per-session rowid watermarks and exact row/message IDs (zero text/clock windows). */
export function computePreview(db: Database, bot: string): PreviewState {
  const item = latestItemPreview(db, bot)
  const mark = item ? (db.query('SELECT event_rowid FROM history_preview_marks WHERE bot=? AND session=?').get(bot, item.latest.session) as { event_rowid: number } | null) : null
  const afterRowid = mark ? mark.event_rowid : 0
  const minAt = item && !mark ? item.latest.preview.at : -1
  const ev = latestEventPreview(db, bot, afterRowid, minAt, c => {
    if (item?.olderSessions.has(c.session)) return true
    if (c.id && hasStoredItem(db, bot, c.id)) return true
    if (item && c.session === item.latest.session && c.messageId && item.messageIds.has(c.messageId)) return true
    return false
  })
  const current = ev ?? item?.latest ?? null
  return { preview: current?.preview ?? null, session: current?.session, messageIds: item?.messageIds, olderSessions: item?.olderSessions }
}
