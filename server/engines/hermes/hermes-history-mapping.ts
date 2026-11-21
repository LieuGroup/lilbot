import type { HistoryRow } from '../../history/history-store'
import { itemsFromRows } from './hermes-chat-mapping'
import { saveFailed } from './hermes-memory-saves'

/** Tool projections omit row_id; their persisted tool_call_id identifies the result instead.
 *  Compaction handoffs (`row_kind: 'compaction'`) sit just before the message row that holds them,
 *  so they get their own `compaction:` id namespace and `row_id - 0.5` order to avoid colliding. */
export function historyRows(nativeId: string, session: string, rows: Record<string, unknown>[]): HistoryRow[] {
  return rows.flatMap(row => {
    const at = Math.round((typeof row.timestamp === 'number' ? row.timestamp : 0) * 1000)
    if (row.row_kind === 'compaction') {
      const hasRowId = typeof row.row_id === 'number'
      if (!hasRowId && at <= 0) return []
      const key = hasRowId ? String(row.row_id) : `t${at}`
      const summary = typeof row.text === 'string' ? row.text.trim() : ''
      const compactedMessages =
        typeof row.compacted_messages === 'number' && Number.isFinite(row.compacted_messages) && row.compacted_messages >= 0 ? Math.round(row.compacted_messages) : undefined
      return [
        {
          id: `hermes:${nativeId}:compaction:${key}`,
          at,
          order: hasRowId ? (row.row_id as number) - 0.5 : -0.5,
          item: {
            kind: 'compaction' as const,
            ...(compactedMessages !== undefined ? { compactedMessages } : {}),
            ...(summary ? { summary } : {})
          }
        }
      ]
    }
    if (row.row_kind !== 'message' || row.display_kind === 'hidden') return []
    const key =
      typeof row.row_id === 'number' ? String(row.row_id) : row.role === 'tool' && typeof row.tool_call_id === 'string' && row.tool_call_id ? `tool:${row.tool_call_id}` : null
    if (key === null) return []
    return itemsFromRows([row], time => saveFailed(nativeId, [session], time)).map(item => ({
      id: `hermes:${nativeId}:${key}`,
      at,
      order: typeof row.row_id === 'number' ? row.row_id : 0,
      item
    }))
  })
}
