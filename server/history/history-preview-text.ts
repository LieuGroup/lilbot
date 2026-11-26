/** Safe single-line preview formatting for main-conversation items and live events.
 *  All pattern scans are strictly linear in input length so adversarial messages cannot stall the event loop. */
import type { BotLastMessage } from '../../shared/bot-schema'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import { hasSecret, stripInvisibleLine } from '../memory/memory-safety'

export const MAX_PREVIEW_CHARS = 140
export type PersistedPreview = { preview: BotLastMessage; id?: string }

const ATTACHMENT_MARKER = /(?:\r?\n){0,2}\[LilBot attachment message [0-9a-f-]{36}\]/gi
const ATTACHED_JSON_BLOCK = /(?:^|(?:\r?\n){1,2})The following JSON lists attached files\.[\s\S]*$/i
const WEBHOOK_NOTE_PREFIX = '[LilBot notice, not from the owner: a run of your webhook'
/** The same note's older opening, still in stored conversations: matched only, never sent. */
const LEGACY_WEBHOOK_NOTE_PREFIX = '[LilBot notice, not from Oscar: a run of your webhook'

/** Linear-time removal of paired fenced notice blocks (`start` .. `end`). */
function stripPaired(text: string, start: string, end: string): string {
  if (!text.includes(start)) return text
  let out = ''
  let pos = 0
  while (pos < text.length) {
    const open = text.indexOf(start, pos)
    if (open < 0) return out + text.slice(pos)
    const close = text.indexOf(end, open + start.length)
    if (close < 0) return out + text.slice(pos)
    out += text.slice(pos, open)
    pos = close + end.length
  }
  return out
}

/** Linear-time removal of `/api/attachments/...` and `.../attachments/<file>` tokens (UUID or named). */
function stripAttachmentPaths(text: string): string {
  if (!text.toLowerCase().includes('attachments')) return text
  return text.replace(/[^\s"'`<>()[\]{}]+/g, token => (/^\/api\/attachments\/.+/i.test(token) || /(?:^|[/\\])attachments[/\\].+/i.test(token) ? '' : token))
}

function attachmentSummary(attachments?: readonly { mime?: string }[]): string {
  const count = attachments?.length ?? 0
  if (count === 0) return 'Sent an attachment'
  const allImages = attachments!.every(file => typeof file.mime === 'string' && file.mime.startsWith('image/'))
  if (allImages) return count === 1 ? 'Sent a photo' : `Sent ${count} photos`
  return count === 1 ? 'Sent an attachment' : `Sent ${count} attachments`
}

function stripMarkdown(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*(?:```|~~~)[^\n]*$/gm, '')
    .replace(/```|~~~/g, ' ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/!\[([^\]\n[]*)\]\([^)\n(\s]*\)/g, '$1')
    .replace(/\[([^\]\n[]+)\]\([^)\n(\s]*\)/g, '$1')
    .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*(?:[-*+][ \t]+|\d+\.[ \t]+)/gm, '')
    .replace(/^[ \t]*[-*_]{3,}[ \t]*$/gm, '')
    .replace(/^[-:| \t]+$/gm, line => (line.includes('-') && line.includes('|') ? '' : line))
    .replace(/\|/g, ' ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(?<!\w)\*([^*\n]+)\*(?!\w)/g, '$1')
    .replace(/(?<!\w)_([^_\n]+)_(?!\w)/g, '$1')
    .replace(/[\n\t]+/g, ' ')
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
  const hasAttachedBlock = ATTACHED_JSON_BLOCK.test(raw)
  let cleaned = stripPaired(stripPaired(raw, WEBHOOK_NOTE_PREFIX, '</webhook-run-message>'), LEGACY_WEBHOOK_NOTE_PREFIX, '</webhook-run-message>')
  cleaned = stripPaired(cleaned, '<webhook-run-message>', '</webhook-run-message>')
  cleaned = stripPaired(cleaned, '<webhook-work-item>', '</webhook-work-item>')
  cleaned = stripAttachmentPaths(cleaned.replace(ATTACHED_JSON_BLOCK, '').replace(ATTACHMENT_MARKER, ''))
  if (hasSecret(cleaned)) return null
  const plain = stripMarkdown(cleaned)
  if (plain) {
    if (hasSecret(plain)) return null
    return { from, text: truncatePreview(plain), at: Math.max(0, Math.round(at)) }
  }
  if (item.kind === 'user' && (item.attachments?.length || hasMarker || hasAttachedBlock)) {
    return { from: 'user', text: attachmentSummary(item.attachments), at: Math.max(0, Math.round(at)) }
  }
  return null
}

/** Builds a safe preview for a live event (`user.message` or non-failed non-empty `turn.finished`), or null otherwise. */
export function previewFromEvent(event: ChatEvent, at: number): BotLastMessage | null {
  if (event.type === 'user.message') return previewFromItem({ kind: 'user', text: typeof event.text === 'string' ? event.text : '', attachments: event.attachments }, at)
  if (event.type === 'turn.finished' && event.status !== 'failed' && !event.failure && typeof event.text === 'string' && event.text.trim()) {
    return previewFromItem({ kind: 'assistant', text: event.text }, at)
  }
  return null
}

/** Extracts a preview plus optional engine turn row id from a live event. */
export function eventCandidate(event: ChatEvent, at: number): PersistedPreview | null {
  const preview = previewFromEvent(event, at)
  if (!preview) return null
  const id = event.type === 'turn.finished' && typeof event.rowId === 'string' ? event.rowId : undefined
  return { preview, id }
}

/** Parses one persisted `history_items` JSON row into a preview with row id, or null if skipped/corrupt. */
export function persistedRowPreview(row: { id?: string; at: number; item: string }): PersistedPreview | null {
  try {
    const item = JSON.parse(row.item) as ChatItem
    const preview = previewFromItem(item, row.at)
    return preview ? { preview, id: row.id } : null
  } catch {
    return null
  }
}
