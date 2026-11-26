/** Every item of the conversation sits where Oscar first saw it. The engine writes a message he sent while the bot was
 *  busy when it starts on it, and a reply when it is complete, so by its times alone a message sent during a hidden turn
 *  falls below that turn's reply. LilBot's journal holds the moment he sent each message and the moment each reply began
 *  to show; an imported row takes that earlier moment. Journal and engine times are only compared between rows whose
 *  moment is known: a row never moves above an earlier row known only by its engine time, so a clock difference cannot
 *  reorder the conversation. A message is matched like its device (`devices/origin-store.ts`): the oldest unmatched send
 *  of the same text in the session, made just before the row. Matches are kept, so importing again gives the same answer. */
import type { Database } from 'bun:sqlite'
import type { HistoryRow } from './history-store'

const WINDOW_MS = 6 * 60 * 60_000
const CLOCK_SKEW_MS = 5_000
type Seen = { event: number; at: number }

/** Every lookup below is an index seek (migration 45: `history_events_type`, `_reply`, `_sent`), so placing a page costs
 *  the same on a long journal as on a short one. */
const TYPE = "json_extract(event,'$.type')"
const FINISHED = `SELECT rowid FROM history_events WHERE bot=?1 AND session=?2 AND ${TYPE}='turn.finished' AND json_extract(event,'$.rowId')=?3 ORDER BY rowid LIMIT 1`
const LAST = `SELECT coalesce(max(rowid),0) id FROM history_events WHERE bot=?1 AND session=?2 AND ${TYPE}=?3 AND rowid<?4`

/** A reply imported while its turn is still open in the journal is not yet placed: it is no floor for a message sent
 *  before it showed, and it takes its place when its turn is journalled as finished (`placeFinished`). The floor is the
 *  newest earlier row known only by its engine time. */
function floorBefore(db: Database, bot: string, session: string, open: number | null, position: number, rowId: string, skip: Set<string>) {
  const next = db.query(
    `SELECT id, at, position, json_extract(item,'$.kind') kind FROM history_items i WHERE bot=?1 AND session=?2 AND position<?3 AND id<>?4 AND (at,position)<(?5,?6)
     AND id NOT LIKE 'journal:%' AND id NOT LIKE 'session:%' AND NOT EXISTS (SELECT 1 FROM history_sent s WHERE s.bot=?1 AND s.row_id=i.id) ORDER BY at DESC, position DESC LIMIT 1`
  )
  let key = [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
  for (;;) {
    const row = next.get(bot, session, position, rowId, key[0], key[1]) as { id: string; at: number; position: number; kind: string } | null
    if (!row) return 0
    if (!skip.has(row.id) && !(open !== null && row.at >= open && row.kind === 'assistant' && !db.query(FINISHED).get(bot, session, row.id))) return row.at
    key = [row.at, row.position]
  }
}

export function atFirstSight(db: Database, bot: string, session: string, rows: HistoryRow[]): HistoryRow[] {
  const open = turnOpen(db, bot, session)
  const pending = new Set<string>()
  const placed = new Set<string>()
  return rows.map((row, index) => {
    if (row.id.startsWith('journal:')) return row
    const seen = row.item.kind === 'user' ? sentAt(db, bot, session, row) : row.item.kind === 'assistant' ? shownAt(db, bot, session, row.id) : null
    if (!seen && open !== null && row.item.kind === 'assistant') pending.add(row.id)
    if (!seen || seen.at >= row.at) return row
    db.query('INSERT OR IGNORE INTO history_sent(bot,event,row_id) VALUES(?,?,?)').run(bot, seen.event, row.id)
    placed.add(row.id)
    const stored = floorBefore(db, bot, session, open, row.order, row.id, pending)
    const batch = rows.slice(0, index).filter(other => !other.id.startsWith('journal:') && !pending.has(other.id) && !placed.has(other.id))
    return { ...row, at: Math.min(row.at, Math.max(seen.at, stored, ...batch.map(other => other.at))) }
  })
}

/** When a turn is journalled as finished, its reply already imported (while the turn was open) takes the moment it began to show. */
export function placeFinished(db: Database, bot: string, session: string, rowId: string) {
  const row = db
    .query('SELECT at, position FROM history_items i WHERE bot=? AND session=? AND id=? AND NOT EXISTS (SELECT 1 FROM history_sent s WHERE s.bot=i.bot AND s.row_id=i.id)')
    .get(bot, session, rowId) as { at: number; position: number } | null
  const seen = row && shownAt(db, bot, session, rowId)
  if (!row || !seen || seen.at >= row.at) return
  db.query('INSERT OR IGNORE INTO history_sent(bot,event,row_id) VALUES(?,?,?)').run(bot, seen.event, rowId)
  const floor = floorBefore(db, bot, session, null, row.position, rowId, new Set())
  db.query('UPDATE history_items SET at=? WHERE bot=? AND id=?').run(Math.min(row.at, Math.max(seen.at, floor)), bot, rowId)
}

const last = (db: Database, bot: string, session: string, type: string, before = Number.MAX_SAFE_INTEGER) => (db.query(LAST).get(bot, session, type, before) as { id: number }).id
/** When the turn still open in the journal started (less the clock allowance), or null when none is open. */
function turnOpen(db: Database, bot: string, session: string) {
  const started = last(db, bot, session, 'turn.started')
  if (started <= last(db, bot, session, 'turn.finished')) return null
  return (db.query('SELECT at FROM history_events WHERE rowid=?').get(started) as { at: number }).at - CLOCK_SKEW_MS
}

function sentAt(db: Database, bot: string, session: string, row: HistoryRow): Seen | null {
  const known = db.query('SELECT e.rowid event, e.at FROM history_sent s JOIN history_events e ON e.rowid=s.event WHERE s.bot=? AND s.row_id=?').get(bot, row.id) as Seen | null
  const text = row.item.kind === 'user' ? row.item.text.trim() : ''
  if (known || !text) return known
  return db
    .query(
      `SELECT e.rowid event, e.at FROM history_events e WHERE e.bot=? AND e.session=? AND ${TYPE}='user.message' AND trim(json_extract(e.event,'$.text'))=?
       AND e.at<=? AND e.at>=? AND NOT EXISTS (SELECT 1 FROM history_sent s WHERE s.bot=e.bot AND s.event=e.rowid) ORDER BY e.rowid LIMIT 1`
    )
    .get(bot, session, text, row.at + CLOCK_SKEW_MS, row.at - WINDOW_MS) as Seen | null
}

/** When the reply this row finished began to show: its turn's first streamed text after the turn's last tool. */
function shownAt(db: Database, bot: string, session: string, rowId: string): Seen | null {
  const done = (db.query(FINISHED).get(bot, session, rowId) as { rowid: number } | null)?.rowid
  if (!done) return null
  const mark = Math.max(...['turn.started', 'tool.started', 'tool.finished', 'turn.finished'].map(type => last(db, bot, session, type, done)))
  return db
    .query(`SELECT rowid event, at FROM history_events WHERE bot=? AND session=? AND ${TYPE}='text.delta' AND rowid>? AND rowid<? ORDER BY rowid LIMIT 1`)
    .get(bot, session, mark, done) as Seen | null
}
