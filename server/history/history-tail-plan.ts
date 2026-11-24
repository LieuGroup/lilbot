/** Bounded in-memory planner for journal fallback on engine switch: skips complete non-dirty sessions, ignores
 *  streamed `text.delta` rows on finished turns, and caps planned rows/bytes while keeping the newest rows in order. */
import type { ChatItem } from '../../shared/chat-schema'
import type { HistoryRow, HistoryStore } from './history-store'
import { type EventRow, embeddedRowId, itemKey, reconstructFromEvents } from './history-tail'

interface PlannedSessionTail {
  session: string
  firstAt: number
  rows: HistoryRow[]
}
export interface JournalTailPlan {
  entries: PlannedSessionTail[]
  truncated: boolean
  totalRows: number
  totalBytes: number
}
interface JournalTailLimits {
  maxRows?: number
  maxBytes?: number
}

export const DEFAULT_JOURNAL_TAIL_ROWS = 200
export const DEFAULT_JOURNAL_TAIL_BYTES = 256 * 1024
const MAX_TRAILING_DELTAS = 500
type ExistingRow = { id: string; at: number; position: number; item: string }
const rowBytes = (row: HistoryRow) => Buffer.byteLength(JSON.stringify(row))

function trimRowToBytes(row: HistoryRow, maxBytes: number): HistoryRow | null {
  if (!('text' in row.item) || typeof row.item.text !== 'string') return null
  const budget = maxBytes - rowBytes({ ...row, item: { ...row.item, text: '' } }) - 4
  if (budget <= 0) return null
  let text = Buffer.from(row.item.text, 'utf8')
    .subarray(0, budget)
    .toString('utf8')
    .replace(/\uFFFD+$/, '')
  if (text.length > 0 && text.charCodeAt(text.length - 1) >= 0xd800 && text.charCodeAt(text.length - 1) <= 0xdbff) text = text.slice(0, -1)
  const trimmed: HistoryRow = { ...row, item: { ...row.item, text: `${text}…` } }
  return rowBytes(trimmed) <= maxBytes ? trimmed : null
}

function loadBoundedSessionEvents(store: HistoryStore, bot: string, session: string, eventLimit: number) {
  const rawDesc = store.db
    .query(`SELECT rowid, at, event, key FROM history_events WHERE bot=? AND session=? AND json_extract(event,'$.type')<>'text.delta' ORDER BY rowid DESC LIMIT ?`)
    .all(bot, session, eventLimit + 1) as EventRow[]
  const moreEvents = rawDesc.length > eventLimit
  const structural = (moreEvents ? rawDesc.slice(0, eventLimit) : rawDesc).reverse()
  const lastStruct = structural.at(-1)
  if (lastStruct?.event.includes('"turn.started"')) {
    const deltas = store.db
      .query(`SELECT rowid, at, event, key FROM history_events WHERE bot=? AND session=? AND rowid>? AND json_extract(event,'$.type')='text.delta' ORDER BY rowid ASC LIMIT ?`)
      .all(bot, session, lastStruct.rowid, MAX_TRAILING_DELTAS) as EventRow[]
    return { events: deltas.length ? [...structural, ...deltas] : structural, moreEvents, oldestAt: structural[0]?.at ?? 0 }
  }
  if (!lastStruct) {
    const deltas = store.db
      .query(`SELECT rowid, at, event, key FROM history_events WHERE bot=? AND session=? AND json_extract(event,'$.type')='text.delta' ORDER BY rowid DESC LIMIT ?`)
      .all(bot, session, MAX_TRAILING_DELTAS) as EventRow[]
    return { events: deltas.reverse(), moreEvents: false, oldestAt: deltas[0]?.at ?? 0 }
  }
  return { events: structural, moreEvents, oldestAt: structural[0]?.at ?? 0 }
}

/** Computes bounded unimported tail rows from `history_events` without mutating SQLite, evaluated fail-closed against `allowed`. */
export function planBotJournalTail(
  store: HistoryStore,
  bot: string,
  allowed: (bot: string, session: string) => boolean,
  project: (bot: string, session: string, rows: HistoryRow[]) => HistoryRow[],
  dirtySessions?: ReadonlySet<string> | ReadonlyMap<string, number>,
  limits: JournalTailLimits = {}
): JournalTailPlan {
  const maxRows = Math.max(1, limits.maxRows ?? DEFAULT_JOURNAL_TAIL_ROWS)
  const maxBytes = Math.max(512, limits.maxBytes ?? DEFAULT_JOURNAL_TAIL_BYTES)
  // Inspect newest sessions first so global row/byte caps naturally retain the contiguous newest suffix.
  const sessionRows = store.db
    .query(
      `SELECT e.session, MIN(e.at) AS firstAt, COALESCE(s.complete, 0) AS complete
       FROM history_events e LEFT JOIN history_sessions s ON s.bot = e.bot AND s.id = e.session
       WHERE e.bot = ? GROUP BY e.session ORDER BY COALESCE(s.at, MIN(e.at)) DESC, MAX(e.rowid) DESC`
    )
    .all(bot) as { session: string; firstAt: number; complete: number }[]

  const entries: PlannedSessionTail[] = []
  let [remainingRows, remainingBytes, totalRows, totalBytes, truncated] = [maxRows, maxBytes, 0, 0, false]

  for (const { session, firstAt, complete } of sessionRows) {
    if (complete === 1 && !dirtySessions?.has(session)) continue
    if (!allowed(bot, session) || store.excluded(bot, session)) continue
    if (remainingRows <= 0 || remainingBytes <= 0) {
      truncated = true
      break
    }

    const { events, moreEvents, oldestAt } = loadBoundedSessionEvents(store, bot, session, Math.max(remainingRows * 4, 32))
    const candidates = reconstructFromEvents(session, events)
    if (!candidates.length) {
      if (moreEvents) {
        truncated = true
        break
      }
      continue
    }

    const existingLimit = Math.max(candidates.length * 2, 400)
    const existingDesc = store.db
      .query("SELECT id, at, position, item FROM history_items WHERE bot=? AND session=? AND id NOT LIKE 'session:%' ORDER BY at DESC, position DESC, id DESC LIMIT ?")
      .all(bot, session, existingLimit) as ExistingRow[]
    const [existingFull, minExistingAt] = [existingDesc.length < existingLimit, existingDesc.at(-1)?.at ?? 0]
    const [existingIds, existingTools, existingMsgs, counts] = [new Set<string>(), new Set<string>(), new Set<string>(), new Map<string, number>()]
    let [maxAt, maxPosAtMaxAt] = [0, -1]
    for (const row of existingDesc) {
      existingIds.add(row.id)
      if (row.at > maxAt) [maxAt, maxPosAtMaxAt] = [row.at, row.position]
      else if (row.at === maxAt && row.position > maxPosAtMaxAt) maxPosAtMaxAt = row.position
      try {
        const parsed = JSON.parse(row.item) as ChatItem
        if (parsed.kind === 'tool') existingTools.add(parsed.toolId)
        if (parsed.kind === 'user' && parsed.messageId) existingMsgs.add(parsed.messageId)
        const key = itemKey(parsed)
        if (key) counts.set(key, (counts.get(key) ?? 0) + 1)
      } catch {}
    }

    const unimported: HistoryRow[] = []
    for (const cand of candidates) {
      if (!existingFull && cand.at < minExistingAt) continue
      const key = itemKey(cand.item)
      const rowRef = embeddedRowId(cand.id, session)
      const exact =
        existingIds.has(cand.id) ||
        (rowRef !== null && existingIds.has(rowRef)) ||
        (cand.item.kind === 'tool' && existingTools.has(cand.item.toolId)) ||
        (cand.item.kind === 'user' && !!cand.item.messageId && existingMsgs.has(cand.item.messageId))
      if (exact || (key && (counts.get(key) ?? 0) > 0)) {
        if (key && (counts.get(key) ?? 0) > 0) counts.set(key, counts.get(key)! - 1)
        continue
      }
      unimported.push(cand)
    }
    const clippedOlder = moreEvents && (existingDesc.length === 0 || unimported[0] === candidates[0] || oldestAt > maxAt)
    if (!unimported.length) {
      if (clippedOlder) {
        truncated = true
        break
      }
      continue
    }

    const selectedDesc: HistoryRow[] = []
    if (clippedOlder) truncated = true
    for (let i = unimported.length - 1; i >= 0; i--) {
      if (remainingRows <= 0) {
        truncated = true
        break
      }
      let row = unimported[i]
      let bytes = rowBytes(row)
      if (bytes > remainingBytes) {
        truncated = true
        if (totalRows === 0 && selectedDesc.length === 0) {
          const fitted = trimRowToBytes(row, remainingBytes)
          if (!fitted) break
          row = fitted
          bytes = rowBytes(fitted)
        } else break
      }
      selectedDesc.push(row)
      remainingRows--
      remainingBytes -= bytes
      totalRows++
      totalBytes += bytes
    }
    if (selectedDesc.length) {
      const ordered = selectedDesc.reverse().map((cand, index) => {
        const at = Math.max(cand.at, maxAt)
        return { ...cand, at, order: at === maxAt ? ++maxPosAtMaxAt : index }
      })
      entries.push({ session, firstAt, rows: project(bot, session, ordered) })
    }
    if (truncated) break
  }

  return { entries: entries.reverse(), truncated, totalRows, totalBytes }
}
