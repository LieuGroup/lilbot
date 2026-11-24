/** Per-bot last-message preview cache derived solely from LilBot's own conversation record.
 *  Cached in memory per bot so roster and detail reads stay O(1) without per-bot history queries on every read. */
import type { Database } from 'bun:sqlite'
import type { BotLastMessage } from '../../shared/bot-schema'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import { MAX_PREVIEW_CHARS, previewFromEvent, previewFromItem } from './history-preview-text'
import type { HistoryRow } from './history-store'

export { MAX_PREVIEW_CHARS, previewFromEvent, previewFromItem }

const CLOCK_SKEW_MS = 10_000
const NOT_EXCLUDED = (bot: string, session: string) => `NOT EXISTS (SELECT 1 FROM history_exclusions x WHERE x.bot=${bot} AND x.session=${session})`

type SourcedPreview = { preview: BotLastMessage; session: string }

const samePreview = (a: BotLastMessage | null, b: BotLastMessage | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.from === b.from && a.text === b.text && a.at === b.at)

const sameMessage = (a: SourcedPreview, b: SourcedPreview) =>
  a.session === b.session && a.preview.from === b.preview.from && a.preview.text === b.preview.text && Math.abs(a.preview.at - b.preview.at) <= CLOCK_SKEW_MS

function latestItemPreview(db: Database, bot: string): SourcedPreview | null {
  const sessions = db.query(`SELECT id FROM history_sessions s WHERE bot=? AND ${NOT_EXCLUDED('s.bot', 's.id')} ORDER BY at DESC, id DESC`).all(bot) as { id: string }[]
  const firstBatch = db.query(
    `SELECT id, at, position, item FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind') IN ('user','assistant')
     ORDER BY at DESC, position DESC, id DESC LIMIT 20`
  )
  const nextBatch = db.query(
    `SELECT id, at, position, item FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind') IN ('user','assistant')
     AND (at, position, id) < (?, ?, ?) ORDER BY at DESC, position DESC, id DESC LIMIT 20`
  )
  for (const session of sessions) {
    let rows = firstBatch.all(bot, session.id) as { id: string; at: number; position: number; item: string }[]
    while (rows.length) {
      for (const row of rows) {
        try {
          const preview = previewFromItem(JSON.parse(row.item) as ChatItem, row.at)
          if (preview) return { preview, session: session.id }
        } catch {}
      }
      if (rows.length < 20) break
      const last = rows.at(-1)!
      rows = nextBatch.all(bot, session.id, last.at, last.position, last.id) as { id: string; at: number; position: number; item: string }[]
    }
  }
  const unindexed = db
    .query(
      `SELECT session, at, item FROM history_items i WHERE bot=? AND json_extract(item,'$.kind') IN ('user','assistant') AND ${NOT_EXCLUDED('i.bot', 'i.session')}
       ORDER BY at DESC, position DESC, id DESC LIMIT 20`
    )
    .all(bot) as { session: string; at: number; item: string }[]
  for (const row of unindexed) {
    try {
      const preview = previewFromItem(JSON.parse(row.item) as ChatItem, row.at)
      if (preview) return { preview, session: row.session }
    } catch {}
  }
  return null
}

function latestEventPreview(db: Database, bot: string, afterAt: number): SourcedPreview | null {
  const first = db.query(
    `SELECT rowid, session, at, event FROM history_events e
     WHERE bot=? AND at > ? AND json_extract(event,'$.type') IN ('user.message','turn.finished') AND ${NOT_EXCLUDED('e.bot', 'e.session')}
     ORDER BY rowid DESC LIMIT 1`
  )
  const next = db.query(
    `SELECT rowid, session, at, event FROM history_events e
     WHERE bot=? AND at > ? AND rowid < ? AND json_extract(event,'$.type') IN ('user.message','turn.finished') AND ${NOT_EXCLUDED('e.bot', 'e.session')}
     ORDER BY rowid DESC LIMIT 5`
  )
  const head = first.get(bot, afterAt) as { rowid: number; session: string; at: number; event: string } | null
  if (!head) return null
  let rows = [head]
  while (rows.length) {
    for (const row of rows) {
      try {
        const preview = previewFromEvent(JSON.parse(row.event) as ChatEvent, row.at)
        if (preview) return { preview, session: row.session }
      } catch {}
    }
    const last = rows.at(-1)!
    rows = next.all(bot, afterAt, last.rowid) as { rowid: number; session: string; at: number; event: string }[]
  }
  return null
}

/** Reconciles persisted `history_items` and live `history_events`, preferring canonical rows when matched within clock skew. */
function computePreview(db: Database, bot: string): SourcedPreview | null {
  const item = latestItemPreview(db, bot)
  const ev = latestEventPreview(db, bot, item ? item.preview.at : -1)
  if (!item) return ev
  if (!ev) return item
  if (sameMessage(item, ev)) return item
  return ev.preview.at > item.preview.at ? ev : item
}

type CacheEntry = { preview: BotLastMessage | null; session?: string; live?: { session: string; at: number } }

/** Per-bot in-memory preview cache maintained on every history write/event and seeded lazily once per bot. */
export class HistoryPreviewCache {
  private entries = new Map<string, CacheEntry>()

  constructor(
    private db: Database,
    private onChanged: (botId: string) => void = () => {}
  ) {}

  get(botId: string): BotLastMessage | undefined {
    let entry = this.entries.get(botId)
    if (!entry) {
      const found = computePreview(this.db, botId)
      entry = { preview: found?.preview ?? null, session: found?.session }
      this.entries.set(botId, entry)
    }
    return entry.preview ?? undefined
  }

  getMany(botIds: readonly string[]): Map<string, BotLastMessage> {
    const out = new Map<string, BotLastMessage>()
    for (const botId of botIds) {
      const preview = this.get(botId)
      if (preview) out.set(botId, preview)
    }
    return out
  }

  onEvent(botId: string, session: string, event: ChatEvent, at: number) {
    const candidate = previewFromEvent(event, at)
    if (!candidate) return
    const prev = this.entries.get(botId)
    if (
      prev?.preview &&
      prev.session === session &&
      prev.preview.from === candidate.from &&
      prev.preview.text === candidate.text &&
      Math.abs(prev.preview.at - candidate.at) <= CLOCK_SKEW_MS
    ) {
      return
    }
    this.entries.set(botId, { preview: candidate, session, live: { session, at: candidate.at } })
    if (!samePreview(prev?.preview ?? null, candidate)) this.onChanged(botId)
  }

  onWrite(botId: string, _session: string, rows: readonly HistoryRow[]) {
    if (!rows.some(row => row.item.kind === 'user' || row.item.kind === 'assistant')) return
    const found = computePreview(this.db, botId)
    const next = found?.preview ?? null
    const prev = this.entries.get(botId)
    if (prev?.live && prev.preview) {
      const liveSource: SourcedPreview = { preview: prev.preview, session: prev.live.session }
      if (!found || (found.preview.at < prev.live.at && !sameMessage(found, liveSource))) return
      const keepLive =
        found.preview.at === prev.live.at && found.session === prev.live.session && found.preview.text === prev.preview.text && found.preview.from === prev.preview.from
      this.entries.set(botId, keepLive ? { preview: next, session: found.session, live: prev.live } : { preview: next, session: found.session })
    } else {
      this.entries.set(botId, { preview: next, session: found?.session })
    }
    if (!samePreview(prev?.preview ?? null, next)) this.onChanged(botId)
  }

  forget(botId: string) {
    this.entries.delete(botId)
  }
}
