import type { Database } from 'bun:sqlite'
import type { HistoryRow, HistoryStore } from '../../server/history/history-store'
import type { ChatEvent } from '../../shared/chat-schema'

export const T = 1_800_000_000_000
export const sent = (text: string): ChatEvent => ({ type: 'user.message', messageId: text, text, attachments: [], images: { support: 'unknown', imageCount: 0 } })
export const started: ChatEvent = { type: 'turn.started' }
export const words = (text: string): ChatEvent => ({ type: 'text.delta', text })
export const tool = (toolId: string): ChatEvent => ({ type: 'tool.started', toolId, name: 'terminal', detail: 'sleep 8' })
export const toolDone = (toolId: string): ChatEvent => ({ type: 'tool.finished', toolId, failed: false })
export const finished = (text: string, rowId: string): ChatEvent => ({ type: 'turn.finished', status: 'completed', text, rowId })

/** Journals each event through the store, then sets its moment exactly, so no test depends on the machine's clock. */
export function journal(store: HistoryStore, db: Database, events: [at: number, event: ChatEvent][]) {
  for (const [at, event] of events) {
    const key = crypto.randomUUID()
    store.event('b', 's', event, key)
    db.query('UPDATE history_events SET at=? WHERE key=?').run(at, key)
  }
}

/** Engine rows as the importer reads them, numbered in the engine's order. */
export const user = (n: number, at: number, text: string): HistoryRow => ({ id: `e:${n}`, at, order: n, item: { kind: 'user', text } })
export const reply = (n: number, at: number, text: string): HistoryRow => ({ id: `e:${n}`, at, order: n, item: { kind: 'assistant', text } })
export const toolRow = (n: number, at: number, toolId: string): HistoryRow => ({
  id: `e:${n}`,
  at,
  order: n,
  item: { kind: 'tool', toolId, name: 'terminal', detail: 'sleep 8', running: false }
})

export const shownTexts = (store: HistoryStore) =>
  store
    .page('b')
    .items.map(row =>
      row.item.kind === 'tool' ? `tool:${row.item.toolId}` : row.item.kind === 'shown' ? `shown:${row.item.file.name}` : 'text' in row.item ? row.item.text : row.item.kind
    )
