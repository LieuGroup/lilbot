import type { HistoryRow } from '../../history/history-store'
import { itemsFromRows } from './hermes-chat-mapping'
import { saveFailed } from './hermes-memory-saves'

/** Tool projections omit row_id; their persisted tool_call_id identifies the result instead. */
export function historyRows(nativeId: string, session: string, rows: Record<string, unknown>[]): HistoryRow[] {
  return rows.flatMap(row => {
    if (row.row_kind !== 'message' || row.display_kind === 'hidden') return []
    const key =
      typeof row.row_id === 'number' ? String(row.row_id) : row.role === 'tool' && typeof row.tool_call_id === 'string' && row.tool_call_id ? `tool:${row.tool_call_id}` : null
    if (key === null) return []
    return itemsFromRows([row], at => saveFailed(nativeId, [session], at)).map(item => ({
      id: `hermes:${nativeId}:${key}`,
      at: Math.round((typeof row.timestamp === 'number' ? row.timestamp : 0) * 1000),
      order: typeof row.row_id === 'number' ? row.row_id : 0,
      item
    }))
  })
}
