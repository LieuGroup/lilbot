/** Per-bot last-message preview derived solely from LilBot's own conversation record.
 *  Cached in memory per bot so roster and detail reads stay O(1) without per-bot history queries on every read. */
import type { Database } from 'bun:sqlite'
import type { BotLastMessage } from '../../shared/bot-schema'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import { hasSecret, stripInvisibleLine } from '../memory/memory-safety'
import type { HistoryRow } from './history-store'

export const MAX_PREVIEW_CHARS = 140

const ATTACHMENT_MARKER = /(?:\r?\n){0,2}\[LilBot attachment message [0-9a-f-]{36}\]/gi
const ATTACHED_JSON_BLOCK = /(?:\r?\n){1,2}The following JSON lists attached files\.[\s\S]*$/i
const WEBHOOK_NOTE = /\[LilBot notice, not from Oscar: a run of your webhook[\s\S]*?<\/webhook-run-message>/g
const WEBHOOK_TAGS = /<(?:webhook-run-message|webhook-work-item)>[\s\S]*?<\/(?:webhook-run-message|webhook-work-item)>/g
const ATTACHMENT_PATH = /(?:\/api\/attachments\/[^\s"'`<>]+|(?:~|\/|[A-Za-z]:\\)?(?:[^\s"'`<>]*[/\\])?attachments[/\\][0-9a-f-]{36}(?:\.[A-Za-z0-9]{1,10})?)/gi
const NOT_EXCLUDED = (bot: string, session: string) => `NOT EXISTS (SELECT 1 FROM history_exclusions x WHERE x.bot=${bot} AND x.session=${session})`

function attachmentSummary(attachments?: readonly { mime?: string }[]): string {
  const count = attachments?.length ?? 0
  if (count === 0) return 'Sent an attachment'
  const allImages = attachments!.every(file => typeof file.mime === 'string' && file.mime.startsWith('image/'))
  if (allImages) return count === 1 ? 'Sent a photo' : `Sent ${count} photos`
  return count === 1 ? 'Sent an attachment' : `Sent ${count} attachments`
}

function stripMarkdown(raw: string): string {
  const text = raw
    .replace(/```[A-Za-z0-9_+-]*\r?\n?/g, ' ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)\n]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)\n]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/^\s*(?:>\s?)+/gm, '')
    .replace(/^\s*(?:[-*+]\s+|\d+\.\s+)/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
    .replace(/[\r\n\t]+/g, ' ')
  return stripInvisibleLine(text).replace(/\s+/g, ' ').trim()
}

function truncatePreview(text: string): string {
  const chars = Array.from(text)
  if (chars.length <= MAX_PREVIEW_CHARS) return text
  return `${chars
    .slice(0, MAX_PREVIEW_CHARS - 1)
    .join('')
    .trimEnd()}…`
}

/** Builds a safe single-line preview for a visible main-conversation item, or null when the item should be skipped. */
export function previewFromItem(item: ChatItem, at: number): BotLastMessage | null {
  if (item.kind !== 'user' && item.kind !== 'assistant') return null
  const raw = typeof item.text === 'string' ? item.text : ''
  const from = item.kind === 'user' ? 'user' : 'bot'
  const hasMarker = ATTACHMENT_MARKER.test(raw)
  ATTACHMENT_MARKER.lastIndex = 0
  const cleaned = raw.replace(WEBHOOK_NOTE, '').replace(WEBHOOK_TAGS, '').replace(ATTACHED_JSON_BLOCK, '').replace(ATTACHMENT_MARKER, '').replace(ATTACHMENT_PATH, '')
  if (hasSecret(cleaned)) return null
  const plain = stripMarkdown(cleaned)
  if (plain) {
    if (hasSecret(plain)) return null
    return { from, text: truncatePreview(plain), at: Math.max(0, Math.round(at)) }
  }
  if (item.kind === 'user' && (item.attachments?.length || hasMarker)) {
    return { from: 'user', text: attachmentSummary(item.attachments), at: Math.max(0, Math.round(at)) }
  }
  return null
}

/** Builds a safe preview for a live event (`user.message` or non-empty `turn.finished`), or null otherwise. */
export function previewFromEvent(event: ChatEvent, at: number): BotLastMessage | null {
  if (event.type === 'user.message') return previewFromItem({ kind: 'user', text: typeof event.text === 'string' ? event.text : '', attachments: event.attachments }, at)
  if (event.type === 'turn.finished' && !event.failure && typeof event.text === 'string' && event.text.trim()) return previewFromItem({ kind: 'assistant', text: event.text }, at)
  return null
}

const samePreview = (a: BotLastMessage | null, b: BotLastMessage | null) =>
  (a === null && b === null) || (a !== null && b !== null && a.from === b.from && a.text === b.text && a.at === b.at)

/** Computes the newest safe visible main-conversation preview for `bot` from SQLite via indexed session/item seeks. */
function computePreview(db: Database, bot: string): BotLastMessage | null {
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
          if (preview) return preview
        } catch {}
      }
      if (rows.length < 20) break
      const last = rows.at(-1)!
      rows = nextBatch.all(bot, session.id, last.at, last.position, last.id) as { id: string; at: number; position: number; item: string }[]
    }
  }
  const unindexed = db
    .query(
      `SELECT at, item FROM history_items i WHERE bot=? AND json_extract(item,'$.kind') IN ('user','assistant') AND ${NOT_EXCLUDED('i.bot', 'i.session')}
       ORDER BY at DESC, position DESC, id DESC LIMIT 20`
    )
    .all(bot) as { at: number; item: string }[]
  for (const row of unindexed) {
    try {
      const preview = previewFromItem(JSON.parse(row.item) as ChatItem, row.at)
      if (preview) return preview
    } catch {}
  }
  const events = db.query(`SELECT at, event FROM history_events e WHERE bot=? AND ${NOT_EXCLUDED('e.bot', 'e.session')} ORDER BY rowid DESC LIMIT 20`).all(bot) as {
    at: number
    event: string
  }[]
  for (const row of events) {
    try {
      const preview = previewFromEvent(JSON.parse(row.event) as ChatEvent, row.at)
      if (preview) return preview
    } catch {}
  }
  return null
}

type CacheEntry = { preview: BotLastMessage | null; live?: { session: string; at: number } }

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
      entry = { preview: computePreview(this.db, botId) }
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
    if (prev?.live?.session === session && prev.preview?.from === candidate.from && prev.preview?.text === candidate.text) return
    this.entries.set(botId, { preview: candidate, live: { session, at: candidate.at } })
    if (!samePreview(prev?.preview ?? null, candidate)) this.onChanged(botId)
  }

  onWrite(botId: string, session: string, rows: readonly HistoryRow[]) {
    if (!rows.some(row => row.item.kind === 'user' || row.item.kind === 'assistant')) return
    const next = computePreview(this.db, botId)
    const prev = this.entries.get(botId)
    if (prev?.live && prev.live.session !== session && (!next || next.at < prev.live.at)) return
    this.entries.set(botId, { preview: next })
    if (!samePreview(prev?.preview ?? null, next)) this.onChanged(botId)
  }

  forget(botId: string) {
    this.entries.delete(botId)
  }
}
