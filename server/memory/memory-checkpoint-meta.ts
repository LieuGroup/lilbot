/** Non-text metadata helpers for pre-compress memory-save refusals:
 *  1. `pieceTiming` locates roughly when a refused stretch/message is from by its stored position across imported
 *     `history_items` and unimported `history_events` — never by matching text and never storing text.
 *  2. `findStoppedTurn` locates the exact stopped user message before a `memory_save` failure, collapsing duplicate
 *     dual-path records for the same stopped turn by durable turn identity while refusing auto-resume on side effects. */
import type { Database } from 'bun:sqlite'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'

export interface RefusedPieceRef {
  role: 'user' | 'assistant'
  messageIndex: number
}

export interface PieceTiming {
  singleMessage: boolean
  pieceAt: number | null
  messagesBack: number | null
}

export type StoppedTurn = { kind: 'none' } | { kind: 'unsafe' } | { kind: 'stopped'; text: string; attachmentIds: string[]; deviceId?: string }

interface StoredTurn {
  role: 'user' | 'assistant'
  at: number
}

function embeddedRowId(id: string, session: string): string | null {
  const prefixA = `journal:${session}:a:`
  if (id.startsWith(prefixA)) return id.slice(prefixA.length)
  const prefixF = `journal:${session}:f:`
  return id.startsWith(prefixF) ? id.slice(prefixF.length) : null
}

function storedConversationTimeline(db: Database, botId: string, chatId: string): StoredTurn[] {
  const fromItems = db
    .query<{ id: string; at: number; item: string }, [string, string]>('SELECT id, at, item FROM history_items WHERE bot = ? AND session = ? ORDER BY at ASC, position ASC, id ASC')
    .all(botId, chatId)
  const imported: StoredTurn[] = []
  const importedIds = new Set<string>()
  const importedMsgIds = new Set<string>()
  let lastImportedAt = -Infinity
  for (const row of fromItems) {
    try {
      const parsed = JSON.parse(row.item) as ChatItem
      if ((parsed.kind !== 'user' && parsed.kind !== 'assistant') || !parsed.text.trim()) continue
      imported.push({ role: parsed.kind, at: row.at })
      importedIds.add(row.id)
      const embedded = embeddedRowId(row.id, chatId)
      if (embedded) importedIds.add(embedded)
      if (parsed.kind === 'user' && parsed.messageId) importedMsgIds.add(parsed.messageId)
      if (row.at > lastImportedAt) lastImportedAt = row.at
    } catch {}
  }

  const fromEvents = db
    .query<{ at: number; event: string }, [string, string]>('SELECT at, event FROM history_events WHERE bot = ? AND session = ? ORDER BY rowid ASC')
    .all(botId, chatId)
  const events: (StoredTurn & { rowId?: string; messageId?: string })[] = []
  const seenMsgIds = new Set<string>()
  const seenRowIds = new Set<string>()
  for (const row of fromEvents) {
    try {
      const ev = JSON.parse(row.event) as ChatEvent
      if (ev.type === 'user.message') {
        if (!ev.text.trim() || (ev.messageId && seenMsgIds.has(ev.messageId))) continue
        if (ev.messageId) seenMsgIds.add(ev.messageId)
        events.push({ role: 'user', at: row.at, ...(ev.messageId ? { messageId: ev.messageId } : {}) })
      } else if (ev.type === 'turn.finished' && !ev.failure && ev.text.trim()) {
        if (ev.rowId) {
          if (seenRowIds.has(ev.rowId)) continue
          seenRowIds.add(ev.rowId)
        } else {
          const prev = events.at(-1)
          if (prev?.role === 'assistant' && !prev.rowId) continue
        }
        events.push({ role: 'assistant', at: row.at, ...(ev.rowId ? { rowId: ev.rowId } : {}) })
      }
    } catch {}
  }

  if (imported.length === 0) return events.map(({ role, at }) => ({ role, at }))
  if (events.length === 0) return imported

  let lastOverlap = -1
  for (let i = 0; i < events.length; i++) {
    const ev = events[i]
    if ((ev.rowId && importedIds.has(ev.rowId)) || (ev.messageId && importedMsgIds.has(ev.messageId))) lastOverlap = i
  }
  const tail = events.slice(lastOverlap + 1).filter(ev => ev.at > lastImportedAt || (lastOverlap >= 0 && ev.at === lastImportedAt && events[lastOverlap].at === lastImportedAt))
  return [...imported, ...tail.map(({ role, at }) => ({ role, at }))]
}

/** Resolves approximate timestamp (`pieceAt`), message distance (`messagesBack`), and single-message flag purely by stored position. */
export function pieceTiming(db: Database, botId: string, chatId: string, pieces: readonly RefusedPieceRef[], totalMessages: number, lastRole?: 'user' | 'assistant'): PieceTiming {
  const distinctMessages = new Set(pieces.map(piece => piece.messageIndex))
  const singleMessage = distinctMessages.size <= 1
  const lastIndex = pieces.length ? Math.max(...pieces.map(piece => piece.messageIndex)) : 0
  const messagesBack = totalMessages > 0 ? Math.max(1, totalMessages - lastIndex) : null
  const first = pieces[0]
  if (!first || totalMessages <= 0) return { singleMessage, pieceAt: null, messagesBack }
  const rows = storedConversationTimeline(db, botId, chatId)
  if (!rows.length) return { singleMessage, pieceAt: null, messagesBack }
  const end = lastRole && rows.length > totalMessages && rows.at(-1)?.role !== lastRole ? rows.length - 1 : rows.length
  const pos = end - (totalMessages - first.messageIndex)
  let pieceAt: number | null = null
  if (pos >= 0 && pos < end && rows[pos].role === first.role) pieceAt = rows[pos].at
  else if (pos - 1 >= 0 && pos - 1 < end && rows[pos - 1].role === first.role) pieceAt = rows[pos - 1].at
  return { singleMessage, pieceAt, messagesBack }
}

/** Inspects the tail of `(botId, chatId)` in SQLite to see whether a user turn stopped cleanly on `memory_save`
 *  before any tool call or assistant output ran. Collapses duplicate records of the same stopped turn written by
 *  both `openChat` and `watchActivity` by durable turn identity (`rowId` when present, or the pending turn itself). */
export function findStoppedTurn(db: Database, botId: string, chatId: string): StoppedTurn {
  const events = db.query<{ event: string }, [string, string]>('SELECT event FROM history_events WHERE bot = ? AND session = ? ORDER BY rowid DESC LIMIT 200').all(botId, chatId)
  if (events.length > 0) {
    let stoppedKey: string | null = null
    let sawSideEffect = false
    for (const row of events) {
      let ev: ChatEvent
      try {
        ev = JSON.parse(row.event) as ChatEvent
      } catch {
        continue
      }
      if (ev.type === 'activity' || ev.type === 'title' || ev.type === 'closed' || ev.type === 'connection.sign_in') continue
      if (stoppedKey === null) {
        if (ev.type === 'turn.finished' && ev.failure === 'memory_save') {
          stoppedKey = ev.rowId ?? ''
          continue
        }
        return { kind: 'none' }
      }
      if (ev.type === 'turn.finished' && ev.failure === 'memory_save') {
        if ((ev.rowId ?? '') !== stoppedKey) return { kind: 'unsafe' }
        continue
      }
      if (ev.type === 'turn.started') continue
      if (ev.type === 'tool.started' || ev.type === 'tool.finished' || (ev.type === 'text.delta' && ev.text.trim())) {
        sawSideEffect = true
        continue
      }
      if (ev.type === 'user.message') {
        if (sawSideEffect) return { kind: 'unsafe' }
        const text = ev.text.trim()
        const attachmentIds = (ev.attachments ?? []).map(file => file.id)
        if (!text && !attachmentIds.length) return { kind: 'unsafe' }
        return { kind: 'stopped', text, attachmentIds, ...(ev.origin?.deviceId ? { deviceId: ev.origin.deviceId } : {}) }
      }
      return { kind: 'unsafe' }
    }
    return stoppedKey !== null ? { kind: 'unsafe' } : { kind: 'none' }
  }

  const items = db
    .query<{ id: string; item: string }, [string, string]>('SELECT id, item FROM history_items WHERE bot = ? AND session = ? ORDER BY at DESC, position DESC, id DESC LIMIT 50')
    .all(botId, chatId)
  let stoppedKey: string | null = null
  let sawSideEffect = false
  for (const row of items) {
    let item: ChatItem
    try {
      item = JSON.parse(row.item) as ChatItem
    } catch {
      continue
    }
    if ((item as { kind: string }).kind === 'session' || item.kind === 'compaction' || item.kind === 'connection.sign_in') continue
    const itemTurnKey = embeddedRowId(row.id, chatId) ?? (row.id.startsWith('journal:') ? '' : row.id)
    if (stoppedKey === null) {
      if (item.kind === 'error' && item.reason === 'memory_save') {
        stoppedKey = itemTurnKey
        continue
      }
      return { kind: 'none' }
    }
    if (item.kind === 'error' && item.reason === 'memory_save') {
      if (itemTurnKey !== stoppedKey) return { kind: 'unsafe' }
      continue
    }
    if (item.kind === 'tool' || item.kind === 'assistant') {
      sawSideEffect = true
      continue
    }
    if (item.kind === 'user') {
      if (sawSideEffect) return { kind: 'unsafe' }
      const text = item.text.trim()
      const attachmentIds = (item.attachments ?? []).map(file => file.id)
      if (!text && !attachmentIds.length) return { kind: 'unsafe' }
      return { kind: 'stopped', text, attachmentIds, ...(item.origin?.deviceId ? { deviceId: item.origin.deviceId } : {}) }
    }
    return { kind: 'unsafe' }
  }
  return stoppedKey !== null ? { kind: 'unsafe' } : { kind: 'none' }
}
