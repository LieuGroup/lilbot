/** Idempotent event-journal reconciliation for closing unimported main-conversation tails without duplicates. */
import type { Database } from 'bun:sqlite'
import type { ChatEvent, ChatItem } from '../../shared/chat-schema'
import type { HistoryRow, HistoryStore } from './history-store'

type EventRow = { rowid: number; at: number; event: string; key: string }
type ExistingRow = { id: string; at: number; position: number; item: string }

function itemKey(item: ChatItem): string | null {
  if (item.kind === 'user') return `user:${item.text.trim()}`
  if (item.kind === 'assistant') return `assistant:${item.text.trim()}`
  if (item.kind === 'tool') return `tool:${item.toolId}`
  if (item.kind === 'error') return `error:${item.reason ?? ''}:${item.text.trim()}`
  return null
}

function reconstructFromEvents(session: string, events: EventRow[]): HistoryRow[] {
  const candidates: HistoryRow[] = []
  const seenUsers = new Set<string>()
  const tools = new Map<string, { index: number; item: Extract<ChatItem, { kind: 'tool' }> }>()
  let [streamText, streamAt, streamKey] = ['', 0, '']

  const flushStream = () => {
    if (streamText.trim()) {
      candidates.push({ id: `journal:${session}:s:${streamKey}`, at: streamAt, order: candidates.length, item: { kind: 'assistant', text: streamText, stopped: true } })
    }
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
      candidates.push({
        id: event.messageId ? `journal:${session}:u:${event.messageId}` : `journal:${session}:e:${row.rowid}`,
        at: row.at,
        order: candidates.length,
        item: {
          kind: 'user',
          text: event.text,
          ...(event.messageId ? { messageId: event.messageId } : {}),
          ...(event.attachments.length ? { attachments: event.attachments } : {}),
          ...(event.images ? { images: event.images } : {}),
          ...(event.origin ? { origin: event.origin } : {})
        }
      })
    } else if (event.type === 'tool.started') {
      if (tools.has(event.toolId)) continue
      const item: Extract<ChatItem, { kind: 'tool' }> = { kind: 'tool', toolId: event.toolId, name: event.name, detail: event.detail, running: false }
      tools.set(event.toolId, { index: candidates.length, item })
      candidates.push({ id: `journal:${session}:t:${event.toolId}`, at: row.at, order: candidates.length, item })
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
      if (event.failure) {
        candidates.push({ id: event.rowId ?? `journal:${session}:f:${row.key}`, at: row.at, order: candidates.length, item: { kind: 'error', text: '', reason: event.failure } })
      } else if (event.text.trim() || event.status === 'stopped') {
        candidates.push({
          id: event.rowId ?? `journal:${session}:a:${row.key}`,
          at: row.at,
          order: candidates.length,
          item: { kind: 'assistant', text: event.text, ...(event.status === 'stopped' ? { stopped: true } : {}), ...(event.usage ? { usage: event.usage } : {}) }
        })
      }
    } else if (event.type === 'error' && event.message.trim()) {
      flushStream()
      candidates.push({ id: `journal:${session}:err:${row.key}`, at: row.at, order: candidates.length, item: { kind: 'error', text: event.message } })
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
    .all(bot, session) as {
    id: string
    item: string
  }[]
  if (!journalRows.length) return
  const incomingTools = new Set<string>()
  const incomingMsgs = new Set<string>()
  const incomingKeys = new Map<string, number>()
  for (const row of canonical) {
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
      const exact = (parsed.kind === 'tool' && incomingTools.has(parsed.toolId)) || (parsed.kind === 'user' && !!parsed.messageId && incomingMsgs.has(parsed.messageId))
      if (exact || (key && (incomingKeys.get(key) ?? 0) > 0)) {
        if (key && (incomingKeys.get(key) ?? 0) > 0) incomingKeys.set(key, incomingKeys.get(key)! - 1)
        del.run(bot, row.id)
      }
    } catch {}
  }
}

/** Reconciles unimported tail items from `history_events` into `history_items` for one bot, fail-closed on hidden/excluded sessions. */
export function reconcileBotJournal(
  store: HistoryStore,
  bot: string,
  allowed: (bot: string, session: string) => boolean,
  project: (bot: string, session: string, rows: HistoryRow[]) => HistoryRow[]
): number {
  const sessions = store.db.query('SELECT session, MIN(at) AS firstAt FROM history_events WHERE bot=? GROUP BY session ORDER BY MIN(rowid)').all(bot) as {
    session: string
    firstAt: number
  }[]
  let written = 0
  for (const { session, firstAt } of sessions) {
    if (!allowed(bot, session) || store.excluded(bot, session)) continue
    const events = store.db.query('SELECT rowid, at, event, key FROM history_events WHERE bot=? AND session=? ORDER BY rowid').all(bot, session) as EventRow[]
    const candidates = reconstructFromEvents(session, events)
    if (!candidates.length) continue
    const existing = store.db
      .query("SELECT id, at, position, item FROM history_items WHERE bot=? AND session=? AND id NOT LIKE 'session:%' ORDER BY at, position, id")
      .all(bot, session) as ExistingRow[]

    const [existingIds, existingTools, existingMsgs, counts] = [new Set<string>(), new Set<string>(), new Set<string>(), new Map<string, number>()]
    let [maxAt, maxPosAtMaxAt] = [0, -1]
    for (const row of existing) {
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

    const kept: HistoryRow[] = []
    for (const cand of candidates) {
      const key = itemKey(cand.item)
      const exact =
        existingIds.has(cand.id) ||
        (cand.item.kind === 'tool' && existingTools.has(cand.item.toolId)) ||
        (cand.item.kind === 'user' && !!cand.item.messageId && existingMsgs.has(cand.item.messageId))
      if (exact || (key && (counts.get(key) ?? 0) > 0)) {
        if (key && (counts.get(key) ?? 0) > 0) counts.set(key, counts.get(key)! - 1)
        continue
      }
      const at = Math.max(cand.at, maxAt)
      kept.push({ ...cand, at, order: at === maxAt ? ++maxPosAtMaxAt : kept.length })
    }
    if (!kept.length) continue
    store.session(bot, session, firstAt)
    store.write(bot, session, project(bot, session, kept))
    written += kept.length
  }
  return written
}
