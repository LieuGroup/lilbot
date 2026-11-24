/** Per-bot last-message preview cache derived solely from LilBot's own conversation record.
 *  Warmed at startup and maintained incrementally so roster and detail reads stay O(1) without per-bot history queries. */
import type { Database } from 'bun:sqlite'
import type { BotLastMessage } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { eventCandidate, MAX_PREVIEW_CHARS, type PersistedPreview, persistedRowPreview, previewFromEvent, previewFromItem, type SourcedPreview } from './history-preview-text'
import type { HistoryRow } from './history-store'

export { MAX_PREVIEW_CHARS, previewFromEvent, previewFromItem }

const CLOCK_SKEW_MS = 10_000
const NOT_EXCLUDED = (bot: string, session: string) => `NOT EXISTS (SELECT 1 FROM history_exclusions x WHERE x.bot=${bot} AND x.session=${session})`

type ItemBatch = { latest: SourcedPreview; recent: PersistedPreview[]; olderSessions: Set<string> }
type ComputedPreview = { current: SourcedPreview | null; batch: ItemBatch | null; fromEvent: boolean }
type CacheEntry = { preview: BotLastMessage | null; session?: string; recent?: PersistedPreview[]; olderSessions?: Set<string>; live?: SourcedPreview }

const samePreview = (a: BotLastMessage | null, b: BotLastMessage | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.from === b.from && a.text === b.text && a.at === b.at)

function sameEntry(p: PersistedPreview, c: PersistedPreview): boolean {
  if (p.id && c.id && p.id === c.id) return true
  if (p.messageId && c.messageId) return p.messageId === c.messageId
  return p.preview.from === c.preview.from && p.preview.text === c.preview.text && Math.abs(p.preview.at - c.preview.at) <= CLOCK_SKEW_MS
}

function isSuperseded(batch: ItemBatch, candidate: SourcedPreview): boolean {
  if (batch.olderSessions.has(candidate.session)) return true
  if (batch.latest.session !== candidate.session) return false
  return batch.recent.some(p => sameEntry(p, candidate))
}

function latestItemPreview(db: Database, bot: string): ItemBatch | null {
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
      const recent = rows.map(persistedRowPreview).filter((p): p is PersistedPreview => p !== null)
      if (recent.length) return { latest: { ...recent[0], session: session.id }, recent, olderSessions: new Set(sessions.slice(i + 1).map(s => s.id)) }
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
  const recent: PersistedPreview[] = []
  let session: string | null = null
  for (const row of unindexed) {
    const entry = persistedRowPreview(row)
    if (!entry) continue
    if (session === null) session = row.session
    if (row.session === session) recent.push(entry)
  }
  return session && recent.length ? { latest: { ...recent[0], session }, recent, olderSessions: new Set() } : null
}

function latestEventPreview(db: Database, bot: string, afterAt: number, skip: (c: SourcedPreview) => boolean): SourcedPreview | null {
  const first = db.query(
    `SELECT rowid, session, at, event FROM history_events e
     WHERE bot=? AND at > ? AND json_extract(event,'$.type') IN ('user.message','turn.finished') AND ${NOT_EXCLUDED('e.bot', 'e.session')}
     ORDER BY at DESC, rowid DESC LIMIT 1`
  )
  const next = db.query(
    `SELECT rowid, session, at, event FROM history_events e
     WHERE bot=? AND at > ? AND at <= ? AND (at < ? OR rowid < ?)
       AND json_extract(event,'$.type') IN ('user.message','turn.finished') AND ${NOT_EXCLUDED('e.bot', 'e.session')}
     ORDER BY at DESC, rowid DESC LIMIT 5`
  )
  const head = first.get(bot, afterAt) as { rowid: number; session: string; at: number; event: string } | null
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
    rows = next.all(bot, afterAt, last.at, last.at, last.rowid) as { rowid: number; session: string; at: number; event: string }[]
  }
  return null
}

/** Reconciles persisted `history_items` and live `history_events`: within one session, stored order is authoritative;
 *  clock timestamps break ties only for unpersisted live events not present in the session's persisted batch. */
function computePreview(db: Database, bot: string): ComputedPreview {
  const batch = latestItemPreview(db, bot)
  const ev = latestEventPreview(db, bot, batch ? batch.latest.preview.at : -1, c => (batch ? isSuperseded(batch, c) : false))
  return ev ? { current: ev, batch, fromEvent: true } : { current: batch?.latest ?? null, batch, fromEvent: false }
}

const toEntry = ({ current, batch, fromEvent }: ComputedPreview): CacheEntry => ({
  preview: current?.preview ?? null,
  session: current?.session,
  recent: batch?.recent,
  olderSessions: batch?.olderSessions,
  live: fromEvent && current ? current : undefined
})

/** Per-bot in-memory preview cache maintained on every history write/event and warmed at startup. */
export class HistoryPreviewCache {
  private entries = new Map<string, CacheEntry>()

  constructor(
    private db: Database,
    private onChanged: (botId: string) => void = () => {}
  ) {}

  private seed(botId: string): CacheEntry {
    const entry = toEntry(computePreview(this.db, botId))
    this.entries.set(botId, entry)
    return entry
  }

  warm(botIds: readonly string[]) {
    for (const botId of botIds) if (!this.entries.has(botId)) this.seed(botId)
  }

  get(botId: string): BotLastMessage | undefined {
    return (this.entries.get(botId) ?? this.seed(botId)).preview ?? undefined
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
    const candidate = eventCandidate(event, at, session)
    if (!candidate) return
    let prev = this.entries.get(botId)
    if (!prev) {
      const batch = latestItemPreview(this.db, botId)
      if (batch) {
        prev = { preview: batch.latest.preview, session: batch.latest.session, recent: batch.recent, olderSessions: batch.olderSessions }
        this.entries.set(botId, prev)
      }
    }
    if (prev?.olderSessions?.has(session)) return
    if (prev?.session === session && prev.recent?.some(p => sameEntry(p, candidate))) return
    if (prev?.session === session && prev.preview && sameEntry({ preview: prev.preview, id: prev.live?.id, messageId: prev.live?.messageId }, candidate)) return
    this.entries.set(botId, {
      preview: candidate.preview,
      session,
      recent: prev?.session === session ? prev.recent : undefined,
      olderSessions: prev?.olderSessions,
      live: candidate
    })
    if (!samePreview(prev?.preview ?? null, candidate.preview)) this.onChanged(botId)
  }

  onWrite(botId: string, _session: string, rows: readonly HistoryRow[]) {
    if (!rows.some(row => row.item.kind === 'user' || row.item.kind === 'assistant')) return
    const computed = computePreview(this.db, botId)
    const prev = this.entries.get(botId)
    if (prev?.live) {
      const superseded = computed.batch ? isSuperseded(computed.batch, prev.live) : false
      if (!superseded && (!computed.current || computed.current.preview.at < prev.live.preview.at)) return
    }
    const next = computed.current?.preview ?? null
    this.entries.set(botId, toEntry(computed))
    if (!samePreview(prev?.preview ?? null, next)) this.onChanged(botId)
  }

  forget(botId: string) {
    this.entries.delete(botId)
  }
}
