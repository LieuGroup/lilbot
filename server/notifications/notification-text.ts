/** Safe notification copy builder: generic lines by default, opt-in previews filtered through history preview & secret rules. */
import { createHash } from 'node:crypto'
import type { NotificationKind, NotificationTarget } from '../../shared/notification-schema'
import { previewFromItem } from '../history/history-preview-text'
import { hasSecret, stripInvisibleLine } from '../memory/memory-safety'
import type { NotificationPayload } from './notification-sender'

const MAX_COLLAPSE_BYTES = 64
const MAX_SNIPPET_CHARS = 140

export type NotificationEvent =
  | { kind: 'reply'; botId: string; botName: string; chatId: string; text: string; at: number; dedupeKey: string }
  | { kind: 'turn_failed'; botId: string; botName: string; chatId: string; reason?: 'memory_save'; at: number; dedupeKey: string }
  | { kind: 'needs_answer'; source: 'work'; botId: string; botName: string; workItemId: string; title: string; question?: string | null; at: number; dedupeKey: string }
  | { kind: 'needs_answer'; source: 'goal'; botId: string; botName: string; goalId: string; title: string; at: number; dedupeKey: string }
  | { kind: 'work_done'; botId: string; botName: string; workItemId: string; title: string; status: 'done' | 'failed'; chatId: string | null; at: number; dedupeKey: string }
  | { kind: 'deploy_failed'; jobId: string; status: 'rolled-back' | 'manual-recovery'; at: number; dedupeKey: string }

/** Bounds APNs `apns-collapse-id` to <= 64 ASCII bytes while preserving uniqueness. */
export function boundCollapseId(raw: string): string {
  const safe = raw.replace(/[^A-Za-z0-9._:-]/g, '_')
  if (Buffer.byteLength(safe, 'utf8') <= MAX_COLLAPSE_BYTES) return safe
  const digest = createHash('sha256').update(raw).digest('hex').slice(0, 16)
  return `${safe.slice(0, MAX_COLLAPSE_BYTES - 17)}:${digest}`
}

function truncateChars(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  return `${chars
    .slice(0, max - 1)
    .join('')
    .trimEnd()}…`
}

function safeTitle(name: string): string {
  const cleaned = stripInvisibleLine(name).replace(/\s+/g, ' ').trim()
  return cleaned ? truncateChars(cleaned, 80) : 'LilBot'
}

function safeSnippet(raw: string | null | undefined, at: number): string | null {
  if (!raw?.trim() || hasSecret(raw)) return null
  const preview = previewFromItem({ kind: 'assistant', text: raw }, at)
  return preview?.text ? truncateChars(preview.text, MAX_SNIPPET_CHARS) : null
}

function targetOf(event: NotificationEvent): NotificationTarget {
  switch (event.kind) {
    case 'reply':
    case 'turn_failed':
      return { kind: 'bot', botId: event.botId }
    case 'needs_answer':
      return event.source === 'work' ? { kind: 'work', workItemId: event.workItemId, botId: event.botId } : { kind: 'goal', goalId: event.goalId, botId: event.botId }
    case 'work_done':
      return { kind: 'work', workItemId: event.workItemId, botId: event.botId }
    case 'deploy_failed':
      return { kind: 'deploy' }
  }
}

function priorityOf(kind: NotificationKind): 'normal' | 'urgent' {
  return kind === 'needs_answer' || kind === 'turn_failed' || kind === 'deploy_failed' ? 'urgent' : 'normal'
}

/** Formats one notification payload for a single device according to its `showPreview` setting. */
export function formatNotification(event: NotificationEvent, showPreview: boolean): NotificationPayload {
  const target = targetOf(event)
  const priority = priorityOf(event.kind)
  if (event.kind === 'deploy_failed') {
    const body = event.status === 'manual-recovery' ? 'A deploy failed and stopped the server' : 'A deploy failed and rolled back'
    return {
      kind: event.kind,
      title: 'LilBot',
      body,
      threadId: 'system:deploy',
      collapseId: boundCollapseId(`deploy:${event.jobId}`),
      priority,
      target,
      dedupeKey: event.dedupeKey,
      createdAt: event.at
    }
  }

  const title = safeTitle(event.botName)
  const threadId = boundCollapseId(`bot:${event.botId}`)
  let body: string
  let collapseId: string | undefined

  if (event.kind === 'reply') {
    body = (showPreview ? safeSnippet(event.text, event.at) : null) ?? 'Sent a reply'
    collapseId = boundCollapseId(`reply:${event.botId}`)
  } else if (event.kind === 'turn_failed') {
    body = event.reason === 'memory_save' ? 'Stopped before saving memory' : 'A turn failed'
  } else if (event.kind === 'needs_answer') {
    body =
      event.source === 'work'
        ? ((showPreview ? safeSnippet(event.question || event.title, event.at) : null) ?? 'Needs your answer')
        : ((showPreview ? safeSnippet(event.title, event.at) : null) ?? 'Needs your agreement on a goal')
  } else {
    const generic = event.status === 'failed' ? 'A task failed' : 'Finished a task'
    const prefix = event.status === 'failed' ? 'Failed: ' : 'Finished: '
    const snippet = showPreview ? safeSnippet(event.title, event.at) : null
    body = snippet ? truncateChars(`${prefix}${snippet}`, MAX_SNIPPET_CHARS) : generic
    collapseId = boundCollapseId(`work:${event.workItemId}`)
  }

  return { kind: event.kind, title, body, threadId, collapseId, priority, target, dedupeKey: event.dedupeKey, createdAt: event.at }
}
