/** Idempotent event-journal reconstruction and canonical-row pruning for unimported history tails. */
import type { Database } from 'bun:sqlite'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import type { HistoryRow } from './history-store'

export type EventRow = { rowid: number; at: number; event: string; key: string }

export function itemKey(item: ChatItem): string | null {
  if (item.kind === 'user') return `user:${item.text.trim()}`
  if (item.kind === 'assistant') return `assistant:${item.text.trim()}`
  if (item.kind === 'tool') return `tool:${item.toolId}`
  if (item.kind === 'compaction') return `compaction:${item.beforeTokens ?? ''}:${item.afterTokens ?? ''}`
  if (item.kind === 'error') return `error:${item.reason ?? ''}:${item.text.trim()}`
  return null
}

export function embeddedRowId(id: string, session: string): string | null {
  const prefixA = `journal:${session}:a:`
  if (id.startsWith(prefixA)) return id.slice(prefixA.length)
  const prefixF = `journal:${session}:f:`
  return id.startsWith(prefixF) ? id.slice(prefixF.length) : null
}

export function reconstructFromEvents(session: string, events: EventRow[]): HistoryRow[] {
  const candidates: HistoryRow[] = []
  const seenUsers = new Set<string>()
  const tools = new Map<string, { index: number; item: Extract<ChatItem, { kind: 'tool' }> }>()
  let [streamText, streamAt, streamKey] = ['', 0, '']
  const push = (id: string, at: number, item: ChatItem) => candidates.push({ id, at, order: candidates.length, item })
  const flushStream = () => {
    if (streamText.trim()) push(`journal:${session}:s:${streamKey}`, streamAt, { kind: 'assistant', text: streamText, stopped: true })
    streamText = ''
  }

  for (const row of events) {
    let event: ChatEvent
    try {
      event = JSON.parse(row.event) as ChatEvent
    } catch {
      continue
    }
    if (event.type === 'user.message') {
      flushStream()
      if (event.messageId && seenUsers.has(event.messageId)) continue
      if (event.messageId) seenUsers.add(event.messageId)
      push(event.messageId ? `journal:${session}:u:${event.messageId}` : `journal:${session}:e:${row.rowid}`, row.at, {
        kind: 'user',
        text: event.text,
        ...(event.messageId ? { messageId: event.messageId } : {}),
        ...(event.attachments.length ? { attachments: event.attachments } : {}),
        ...(event.images ? { images: event.images } : {}),
        ...(event.origin ? { origin: event.origin } : {})
      })
    } else if (event.type === 'tool.started') {
      if (tools.has(event.toolId)) continue
      const item: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', toolId: event.toolId, name: event.name, detail: event.detail, running: false }
      tools.set(event.toolId, { index: candidates.length, item })
      push(`journal:${session}:t:${event.toolId}`, row.at, item)
    } else if (event.type === 'tool.finished') {
      const hit = tools.get(event.toolId)
      if (hit && event.failed) {
        hit.item = { ...hit.item, failed: true }
        candidates[hit.index] = { ...candidates[hit.index], item: hit.item }
      }
    } else if (event.type === 'turn.started') {
      ;[streamText, streamAt, streamKey] = ['', row.at, row.key]
    } else if (event.type === 'text.delta') {
      if (!streamText) [streamAt, streamKey] = [row.at, row.key]
      streamText += event.text
    } else if (event.type === 'turn.finished') {
      streamText = ''
      if (event.compacted && (event.compacted.beforeTokens !== undefined || event.compacted.afterTokens !== undefined)) {
        push(`journal:${session}:c:${row.key}`, row.at, {
          kind: 'compaction',
          ...(event.compacted.beforeTokens !== undefined ? { beforeTokens: event.compacted.beforeTokens } : {}),
          ...(event.compacted.afterTokens !== undefined ? { afterTokens: event.compacted.afterTokens } : {})
        })
      }
      const suffix = event.rowId ?? row.key
      if (event.failure) push(`journal:${session}:f:${suffix}`, row.at, { kind: 'error', text: '', reason: event.failure })
      else if (event.text.trim() || event.status === 'stopped') {
        push(`journal:${session}:a:${suffix}`, row.at, {
          kind: 'assistant',
          text: event.text,
          ...(event.status === 'stopped' ? { stopped: true } : {}),
          ...(event.usage ? { usage: event.usage } : {})
        })
      }
    } else if (event.type === 'error' && event.message.trim()) {
      flushStream()
      push(`journal:${session}:err:${row.key}`, row.at, { kind: 'error', text: event.message })
    }
  }
  flushStream()
  return candidates
}

/** Removes any reconciled `journal:` placeholder rows superseded by canonical engine rows written in the same transaction. */
export function pruneSupersededJournalRows(db: Database, bot: string, session: string, incoming: HistoryRow[]) {
  const canonical = incoming.filter(row => !row.id.startsWith('journal:'))
  if (!canonical.length) return
  const journalRows = db
    .query("SELECT id, item FROM history_items WHERE bot=? AND id >= 'journal:' AND id < 'journal;' AND session=? ORDER BY at, position, id")
    .all(bot, session) as { id: string; item: string }[]
  if (!journalRows.length) return
  const [incomingIds, incomingTools, incomingMsgs, incomingKeys] = [new Set<string>(), new Set<string>(), new Set<string>(), new Map<string, number>()]
  for (const row of canonical) {
    incomingIds.add(row.id)
    if (row.item.kind === 'tool') incomingTools.add(row.item.toolId)
    if (row.item.kind === 'user' && row.item.messageId) incomingMsgs.add(row.item.messageId)
    const key = itemKey(row.item)
    if (key) incomingKeys.set(key, (incomingKeys.get(key) ?? 0) + 1)
  }
  const del = db.query('DELETE FROM history_items WHERE bot=? AND id=?')
  for (const row of journalRows) {
    try {
      const parsed = JSON.parse(row.item) as ChatItem
      const key = itemKey(parsed)
      const rowRef = embeddedRowId(row.id, session)
      const exact =
        (rowRef !== null && incomingIds.has(rowRef)) ||
        (parsed.kind === 'tool' && incomingTools.has(parsed.toolId)) ||
        (parsed.kind === 'user' && !!parsed.messageId && incomingMsgs.has(parsed.messageId))
      if (exact || (key && (incomingKeys.get(key) ?? 0) > 0)) {
        if (key && (incomingKeys.get(key) ?? 0) > 0) incomingKeys.set(key, incomingKeys.get(key)! - 1)
        del.run(bot, row.id)
      }
    } catch {}
  }
}

/** Whether a `turn.finished` event (by event key or canonical row id) is already stored in history. */
export function hasRecordedTurn(db: Database, bot: string, session: string, rowId?: string, key?: string): boolean {
  if (key && db.query('SELECT 1 FROM history_events WHERE bot=? AND session=? AND key=? LIMIT 1').get(bot, session, key)) return true
  if (!rowId) return false
  if (db.query('SELECT 1 FROM history_items WHERE bot=? AND id=? LIMIT 1').get(bot, rowId)) return true
  return !!db
    .query(`SELECT 1 FROM history_events WHERE bot=? AND session=? AND json_extract(event,'$.type')='turn.finished' AND json_extract(event,'$.rowId')=? LIMIT 1`)
    .get(bot, session, rowId)
}

/** Visible user messages stored in history that do not yet have a following `turn.finished` (oldest first), for mid-turn restart recovery. */
export function unansweredStoredUsers(db: Database, bot: string, session: string): string[] {
  const lastTurn = db
    .query(
      `SELECT COALESCE(MAX(first_id), 0) AS id FROM (SELECT MIN(rowid) AS first_id FROM history_events WHERE bot=? AND session=? AND json_extract(event,'$.type')='turn.finished' GROUP BY COALESCE(json_extract(event,'$.rowId'), CAST(rowid AS TEXT)))`
    )
    .get(bot, session) as { id: number }
  const fromEvents = db
    .query(
      `SELECT json_extract(event,'$.text') AS text FROM history_events WHERE bot=? AND session=? AND rowid>? AND json_extract(event,'$.type')='user.message' ORDER BY rowid ASC`
    )
    .all(bot, session, lastTurn.id)
    .map(row => (row as { text: string | null }).text ?? '')
    .filter(text => text.trim().length > 0)
  if (fromEvents.length) return fromEvents
  if (lastTurn.id > 0) return []
  const lastItem = db
    .query(
      `SELECT json_extract(item,'$.kind') AS kind, text FROM history_items WHERE bot=? AND session=? AND json_extract(item,'$.kind') IN ('user','assistant') ORDER BY at DESC, position DESC, rowid DESC LIMIT 1`
    )
    .get(bot, session) as { kind: string; text: string } | null
  return lastItem?.kind === 'user' && lastItem.text.trim() ? [lastItem.text] : []
}
