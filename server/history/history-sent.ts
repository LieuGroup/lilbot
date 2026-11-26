/** Every item of the conversation sits where Oscar first saw it. The engine keeps everything in the order it happened,
 *  except a message he sent while the bot was busy: it writes that when it starts on it, below the replies and tools that
 *  showed after he sent it. So an imported message moves up past exactly those rows, and the decision compares only
 *  positions in LilBot's journal (its event sequence), never a time from one clock with a time from another: a row
 *  belongs after the message when the journal event at which LilBot first showed it (its tool's start, or the first words
 *  of its reply) comes after the message's send. The message is matched like its device (`devices/origin-store.ts`): the
 *  oldest unmatched send of the same text in the session, made before the row; the match is kept and a placed row is
 *  never moved again, so importing again, opening the chat or restarting gives the same answer. */
import type { Database } from 'bun:sqlite'
import type { ChatItem } from '../../shared/chat-schema'
import type { HistoryRow } from './history-store'

const WINDOW_MS = 6 * 60 * 60_000
const CLOCK_SKEW_MS = 5_000
/** The most rows a message moves past: far more than one busy turn shows. */
const MOST_PASSED = 500
type Seen = { event: number; at: number }
type Stored = { id: string; at: number; position: number; item: string }

/** Every lookup below is an index seek (migration 46: `history_events_type`, `_reply`, `_sent`, `_tool`, and
 *  `history_order`), so placing a message costs the same on a long journal as on a short one. */
const TYPE = "json_extract(event,'$.type')"
const FINISHED = `SELECT rowid FROM history_events WHERE bot=?1 AND session=?2 AND ${TYPE}='turn.finished' AND json_extract(event,'$.rowId')=?3 ORDER BY rowid LIMIT 1`
const STARTED = `SELECT rowid FROM history_events WHERE bot=?1 AND session=?2 AND ${TYPE}='tool.started' AND json_extract(event,'$.toolId')=?3 ORDER BY rowid LIMIT 1`
const LAST = `SELECT coalesce(max(rowid),0) id FROM history_events WHERE bot=?1 AND session=?2 AND ${TYPE}=?3 AND rowid<?4`

/** Where a message the page brings for the first time goes; every other row, and a message already stored, keeps the
 *  engine's place. Called just before the row is stored, after the rows above it in the page. */
export function placeMessage(db: Database, bot: string, session: string, row: HistoryRow): HistoryRow {
  if (row.item.kind !== 'user' || row.id.startsWith('journal:') || db.query('SELECT 1 FROM history_items WHERE bot=? AND id=?').get(bot, row.id)) return row
  const sent = sentAt(db, bot, session, row)
  if (!sent) return row
  db.query('INSERT OR IGNORE INTO history_sent(bot,event,row_id) VALUES(?,?,?)').run(bot, sent.event, row.id)
  const before = db.query('SELECT id, at, position, item FROM history_items WHERE bot=? AND session=? AND (at,position)<(?,?) ORDER BY at DESC, position DESC LIMIT 1')
  let [first, next]: (Stored | null)[] = [null, null]
  let above = before.get(bot, session, row.at, row.order) as Stored | null
  for (let passed = 0; above && passed < MOST_PASSED && shownAfter(db, bot, session, above, next, sent); passed++) {
    ;[first, next] = [above, above]
    above = before.get(bot, session, above.at, above.position) as Stored | null
  }
  if (!first) return row
  // Any key strictly between the row it now follows and the first row it passed keeps that order; the time shown is the
  // moment it was sent, held within those two rows' times.
  const at = Math.min(first.at, Math.max(sent.at, above?.at ?? sent.at))
  const order = at === above?.at ? (at === first.at ? (above.position + first.position) / 2 : above.position + 0.25) : at === first.at ? first.position - 0.25 : row.order
  return { ...row, at, order }
}

/** Whether LilBot first showed this stored row after the message was sent. `next` is the row just below it. */
function shownAfter(db: Database, bot: string, session: string, row: Stored, next: Stored | null, sent: Seen): boolean {
  const item = JSON.parse(row.item) as ChatItem
  const after = (event: number | undefined | null) => !!event && event > sent.event
  // LilBot's own rows (a shown file, a sign-in card, a thread or work line, the journal's stand-ins) carry LilBot's time, as the send does.
  if (item.kind === 'shown' || item.kind === 'connection.sign_in' || (item.kind === 'tool' && row.id === item.toolId) || row.id.startsWith('journal:')) return row.at > sent.at
  if (item.kind === 'tool') return after(started(db, bot, session, item.toolId))
  if (item.kind === 'user') return after((db.query('SELECT event FROM history_sent WHERE bot=? AND row_id=?').get(bot, row.id) as { event: number } | null)?.event)
  if (item.kind !== 'assistant') return false
  const done = (db.query(FINISHED).get(bot, session, row.id) as { rowid: number } | null)?.rowid
  if (done) return after(wordsBefore(db, bot, session, done)?.event ?? done)
  const tool = next && (JSON.parse(next.item) as ChatItem)
  const start = tool?.kind === 'tool' ? started(db, bot, session, tool.toolId) : null
  if (start) return after(wordsBefore(db, bot, session, start)?.event)
  // The reply of a turn whose end is not journalled yet (the importer read it a moment before): its words are the open
  // turn's. A reply the engine wrote well before the message was sent is never that one.
  const open = last(db, bot, session, 'turn.started', Number.MAX_SAFE_INTEGER)
  if (row.at < sent.at - CLOCK_SKEW_MS || open > sent.event || open <= last(db, bot, session, 'turn.finished', Number.MAX_SAFE_INTEGER)) return false
  return after(wordsBefore(db, bot, session, Number.MAX_SAFE_INTEGER)?.event)
}

const started = (db: Database, bot: string, session: string, toolId: string) => (db.query(STARTED).get(bot, session, toolId) as { rowid: number } | null)?.rowid ?? null
const last = (db: Database, bot: string, session: string, type: string, before: number) => (db.query(LAST).get(bot, session, type, before) as { id: number }).id

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

/** The first words shown in the stretch of the journal that ends at `end`, since the turn's last start, tool or end. */
function wordsBefore(db: Database, bot: string, session: string, end: number): Seen | null {
  const mark = Math.max(...['turn.started', 'tool.started', 'tool.finished', 'turn.finished'].map(type => last(db, bot, session, type, end)))
  return db
    .query(`SELECT rowid event, at FROM history_events WHERE bot=? AND session=? AND ${TYPE}='text.delta' AND rowid>? AND rowid<? ORDER BY rowid LIMIT 1`)
    .get(bot, session, mark, end) as Seen | null
}
