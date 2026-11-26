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

/** A reply imported while its turn is still open in the journal is not yet placed: it is no floor for a message sent
 *  before it showed, and it takes its place when its turn is journalled as finished (`placeFinished`). */
const PENDING = `json_extract(i.item,'$.kind')='assistant' AND ?3 AND NOT EXISTS (SELECT 1 FROM history_events e WHERE e.bot=?1 AND e.session=?2
  AND json_extract(e.event,'$.type')='turn.finished' AND json_extract(e.event,'$.rowId')=i.id)`
const FLOOR = `SELECT max(at) at FROM history_items i WHERE bot=?1 AND session=?2 AND position<?4 AND id<>?5 AND id NOT LIKE 'journal:%' AND id NOT LIKE 'session:%'
  AND NOT EXISTS (SELECT 1 FROM history_sent s WHERE s.bot=?1 AND s.row_id=i.id) AND NOT (${PENDING})`

export function atFirstSight(db: Database, bot: string, session: string, rows: HistoryRow[]): HistoryRow[] {
  const open = turnOpen(db, bot, session)
  const pending = new Set<string>()
  return rows.map((row, index) => {
    if (row.id.startsWith('journal:')) return row
    const seen = row.item.kind === 'user' ? sentAt(db, bot, session, row) : row.item.kind === 'assistant' ? shownAt(db, bot, session, row.id) : null
    if (!seen && open && row.item.kind === 'assistant') pending.add(row.id)
    if (!seen || seen.at >= row.at) return row
    db.query('INSERT OR IGNORE INTO history_sent(bot,event,row_id) VALUES(?,?,?)').run(bot, seen.event, row.id)
    const stored = (db.query(FLOOR).get(bot, session, open, row.order, row.id) as { at: number | null }).at ?? 0
    const batch = rows.slice(0, index).filter(other => !other.id.startsWith('journal:') && !pending.has(other.id) && !sight(db, bot, other.id))
    return { ...row, at: Math.min(row.at, Math.max(seen.at, stored, ...batch.map(other => other.at))) }
  })
}

/** When a turn is journalled as finished, its reply already imported (while the turn was open) takes the moment it began to show. */
export function placeFinished(db: Database, bot: string, session: string, rowId: string) {
  const row = db
    .query('SELECT at, position FROM history_items i WHERE bot=? AND session=? AND id=? AND NOT EXISTS (SELECT 1 FROM history_sent s WHERE s.bot=i.bot AND s.row_id=i.id)')
    .get(bot, session, rowId) as {
    at: number
    position: number
  } | null
  const seen = row && shownAt(db, bot, session, rowId)
  if (!row || !seen || seen.at >= row.at) return
  db.query('INSERT OR IGNORE INTO history_sent(bot,event,row_id) VALUES(?,?,?)').run(bot, seen.event, rowId)
  const floor = (db.query(FLOOR).get(bot, session, false, row.position, rowId) as { at: number | null }).at ?? 0
  db.query('UPDATE history_items SET at=? WHERE bot=? AND id=?').run(Math.min(row.at, Math.max(seen.at, floor)), bot, rowId)
}

const turnOpen = (db: Database, bot: string, session: string) => {
  const last = (type: string) =>
    (db.query("SELECT coalesce(max(rowid),0) id FROM history_events WHERE bot=? AND session=? AND json_extract(event,'$.type')=?").get(bot, session, type) as { id: number }).id
  return last('turn.started') > last('turn.finished')
}

const sight = (db: Database, bot: string, rowId: string) => !!db.query('SELECT 1 FROM history_sent WHERE bot=? AND row_id=?').get(bot, rowId)

function sentAt(db: Database, bot: string, session: string, row: HistoryRow): Seen | null {
  const known = db.query('SELECT e.rowid event, e.at FROM history_sent s JOIN history_events e ON e.rowid=s.event WHERE s.bot=? AND s.row_id=?').get(bot, row.id) as Seen | null
  const text = row.item.kind === 'user' ? row.item.text.trim() : ''
  if (known || !text) return known
  return db
    .query(
      `SELECT e.rowid event, e.at FROM history_events e WHERE e.bot=? AND e.session=? AND json_extract(e.event,'$.type')='user.message' AND trim(json_extract(e.event,'$.text'))=?
       AND e.at<=? AND e.at>=? AND NOT EXISTS (SELECT 1 FROM history_sent s WHERE s.bot=e.bot AND s.event=e.rowid) ORDER BY e.rowid LIMIT 1`
    )
    .get(bot, session, text, row.at + CLOCK_SKEW_MS, row.at - WINDOW_MS) as Seen | null
}

/** When the reply this row finished began to show: its turn's first streamed text after the turn's last tool. */
function shownAt(db: Database, bot: string, session: string, rowId: string): Seen | null {
  return db
    .query(
      `WITH done AS (SELECT min(rowid) id FROM history_events WHERE bot=?1 AND session=?2 AND json_extract(event,'$.type')='turn.finished' AND json_extract(event,'$.rowId')=?3),
       mark AS (SELECT coalesce(max(e.rowid),0) id FROM history_events e, done WHERE e.bot=?1 AND e.session=?2 AND e.rowid<done.id
         AND json_extract(e.event,'$.type') IN ('turn.started','tool.started','tool.finished','turn.finished'))
       SELECT e.rowid event, e.at FROM history_events e, done, mark WHERE e.bot=?1 AND e.session=?2 AND e.rowid>mark.id AND e.rowid<done.id
         AND json_extract(e.event,'$.type')='text.delta' ORDER BY e.rowid LIMIT 1`
    )
    .get(bot, session, rowId) as Seen | null
}
