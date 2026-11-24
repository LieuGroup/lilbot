/** Single-row-per-bot preview table (`history_previews`), written atomically with qualifying live events and backfilled once from `history_items` when absent. */
import type { Database } from 'bun:sqlite'
import type { BotLastMessage } from '../../shared/bot-schema'
import type { ChatEvent } from '../../shared/chat-schema'
import { eventCandidate, MAX_PREVIEW_CHARS, persistedRowPreview, previewFromEvent, previewFromItem } from './history-preview-text'

export { MAX_PREVIEW_CHARS, previewFromEvent, previewFromItem }

type StoredPreviewRow = { bot: string; who: 'user' | 'bot'; text: string; at: number; session: string }
type SessionOrder = { at: number; id: string }

const MAX_SEEN_TURN_IDS = 512
const NOT_EXCLUDED = (bot: string, session: string) => `NOT EXISTS (SELECT 1 FROM history_exclusions x WHERE x.bot=${bot} AND x.session=${session})`
const toLastMessage = (row: Pick<StoredPreviewRow, 'who' | 'text' | 'at'>): BotLastMessage => ({ from: row.who, text: row.text, at: row.at })
const samePreview = (a: Pick<StoredPreviewRow, 'who' | 'text' | 'at'> | null, b: BotLastMessage) => a !== null && a.who === b.from && a.text === b.text && a.at === b.at
const isNewerSession = (a: SessionOrder, b: SessionOrder) => a.at > b.at || (a.at === b.at && a.id > b.id)

const sessionOrder = (db: Database, bot: string, session: string) => db.query('SELECT at, id FROM history_sessions WHERE bot=? AND id=?').get(bot, session) as SessionOrder | null

/** Allows a live event to update `history_previews` only for the bot's current main session or a strictly newer session. */
function canUpdatePreviewSession(db: Database, bot: string, session: string, existingSession: string | null): boolean {
  const mainChat = (db.query('SELECT main_chat_id FROM bot_prefs WHERE bot_id=?').get(bot) as { main_chat_id: string | null } | null)?.main_chat_id ?? null
  if (mainChat !== null) {
    if (session === mainChat) return true
    const [incoming, current] = [sessionOrder(db, bot, session), sessionOrder(db, bot, mainChat)]
    return incoming !== null && current !== null && isNewerSession(incoming, current)
  }
  if (!existingSession || existingSession === session) return true
  const [incoming, existing] = [sessionOrder(db, bot, session), sessionOrder(db, bot, existingSession)]
  if (incoming && existing) return isNewerSession(incoming, existing)
  return !(incoming && !existing)
}

/** Rejects late `turn.finished` replays whose `rowId` is already persisted behind a newer visible item in `history_items`. */
function isSupersededStoredItem(db: Database, bot: string, session: string, rowId: string): boolean {
  const stored = db.query('SELECT session FROM history_items WHERE bot=? AND id=? LIMIT 1').get(bot, rowId) as { session: string } | null
  if (!stored) return false
  if (stored.session !== session) return true
  const rows = db
    .query(
      `SELECT id, at, item FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind') IN ('user','assistant')
       ORDER BY at DESC, position DESC, id DESC LIMIT 20`
    )
    .all(bot, session) as { id: string; at: number; item: string }[]
  for (const row of rows) if (persistedRowPreview(row)) return row.id !== rowId
  return false
}

/** Finds the newest visible message across non-excluded `history_items` for one-time backfill of bots with no preview row. */
function latestStoredPreview(db: Database, bot: string): { preview: BotLastMessage; session: string } | null {
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
        const entry = persistedRowPreview(row)
        if (entry) return { preview: entry.preview, session: session.id }
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
  for (const row of unindexed) {
    const entry = persistedRowPreview(row)
    if (entry) return { preview: entry.preview, session: row.session }
  }
  return null
}

/** Reads and maintains one durable preview row per bot in `history_previews`. */
export class HistoryPreviewStore {
  private checkedEmpty = new Set<string>()
  private seenTurnIds = new Set<string>()

  constructor(
    private db: Database,
    private onChanged: (botId: string) => void = () => {}
  ) {}

  private backfillOne(botId: string): BotLastMessage | undefined {
    const found = latestStoredPreview(this.db, botId)
    if (!found) {
      this.checkedEmpty.add(botId)
      return undefined
    }
    try {
      this.db
        .query('INSERT OR IGNORE INTO history_previews(bot, who, text, at, session) VALUES(?, ?, ?, ?, ?)')
        .run(botId, found.preview.from, found.preview.text, found.preview.at, found.session)
    } catch {}
    return found.preview
  }

  get(botId: string): BotLastMessage | undefined {
    try {
      const row = this.db.query('SELECT who, text, at FROM history_previews WHERE bot=?').get(botId) as Pick<StoredPreviewRow, 'who' | 'text' | 'at'> | null
      if (row) return toLastMessage(row)
      return this.checkedEmpty.has(botId) ? undefined : this.backfillOne(botId)
    } catch (error) {
      console.error(`[history] preview read failed for ${botId}:`, error instanceof Error ? error.message : error)
      return undefined
    }
  }

  getMany(botIds: readonly string[]): Map<string, BotLastMessage> {
    const out = new Map<string, BotLastMessage>()
    if (!botIds.length) return out
    try {
      const rows = this.db.query('SELECT bot, who, text, at FROM history_previews').all() as Pick<StoredPreviewRow, 'bot' | 'who' | 'text' | 'at'>[]
      const byBot = new Map(rows.map(row => [row.bot, toLastMessage(row)]))
      for (const botId of botIds) {
        const preview = byBot.get(botId) ?? (this.checkedEmpty.has(botId) ? undefined : this.backfillOne(botId))
        if (preview) out.set(botId, preview)
      }
    } catch (error) {
      console.error('[history] preview list read failed:', error instanceof Error ? error.message : error)
    }
    return out
  }

  /** Runs inside `HistoryStore.event`'s transaction; upserts `history_previews` for qualifying live events. */
  recordEvent(botId: string, session: string, event: ChatEvent, at: number): { changed: boolean; turnId?: string } {
    const candidate = eventCandidate(event, at, session)
    if (!candidate) return { changed: false }
    if (candidate.id && (this.seenTurnIds.has(`${botId}\0${candidate.id}`) || isSupersededStoredItem(this.db, botId, session, candidate.id))) return { changed: false }
    const existing = this.db.query('SELECT who, text, at, session FROM history_previews WHERE bot=?').get(botId) as Omit<StoredPreviewRow, 'bot'> | null
    if (!canUpdatePreviewSession(this.db, botId, session, existing?.session ?? null)) return { changed: false }
    this.db
      .query(
        `INSERT INTO history_previews(bot, who, text, at, session) VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(bot) DO UPDATE SET who=excluded.who, text=excluded.text, at=excluded.at, session=excluded.session`
      )
      .run(botId, candidate.preview.from, candidate.preview.text, candidate.preview.at, session)
    return { changed: !samePreview(existing, candidate.preview), turnId: candidate.id }
  }

  /** Runs inside `HistoryStore.writeUnchecked`'s transaction: backfills once only when a bot has no preview row yet. */
  backfillIfMissing(botId: string): boolean {
    if (this.db.query('SELECT 1 FROM history_previews WHERE bot=?').get(botId)) return false
    const found = latestStoredPreview(this.db, botId)
    if (!found) return false
    const res = this.db
      .query('INSERT OR IGNORE INTO history_previews(bot, who, text, at, session) VALUES(?, ?, ?, ?, ?)')
      .run(botId, found.preview.from, found.preview.text, found.preview.at, found.session)
    return res.changes > 0
  }

  afterEventCommit(botId: string, changed: boolean, turnId?: string) {
    if (turnId) {
      const key = `${botId}\0${turnId}`
      this.seenTurnIds.delete(key)
      this.seenTurnIds.add(key)
      if (this.seenTurnIds.size > MAX_SEEN_TURN_IDS) this.seenTurnIds.delete(this.seenTurnIds.values().next().value!)
    }
    if (changed) {
      this.checkedEmpty.delete(botId)
      this.onChanged(botId)
    }
  }

  afterWriteCommit(botId: string, changed: boolean) {
    if (changed) {
      this.checkedEmpty.delete(botId)
      this.onChanged(botId)
    }
  }

  forget(botId: string) {
    this.checkedEmpty.delete(botId)
    const prefix = `${botId}\0`
    for (const key of this.seenTurnIds) if (key.startsWith(prefix)) this.seenTurnIds.delete(key)
  }
}
