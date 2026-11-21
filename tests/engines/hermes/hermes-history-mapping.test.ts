import { expect, test } from 'bun:test'
import { historyRows } from '../../../server/engines/hermes/hermes-history-mapping'

test('tool projections without row_id retain stable ids, detail and available result status', () => {
  const rows = [
    { row_kind: 'message', role: 'user', row_id: 1, timestamp: 1, text: 'run commands' },
    { row_kind: 'message', role: 'tool', tool_call_id: 'call-a', timestamp: 2, name: 'terminal', context: 'date' },
    { row_kind: 'message', role: 'tool', tool_call_id: 'call-b', timestamp: 3, name: 'terminal', context: 'false', content: { exit_code: 1 } },
    { row_kind: 'message', role: 'assistant', row_id: 5, timestamp: 4, text: 'done' },
    { row_kind: 'message', role: 'user', row_id: 6, display_kind: 'hidden', text: 'internal' },
    { row_kind: 'compaction', role: 'system', row_id: 7, text: 'summary' }
  ]
  const result = historyRows('dev-test', 'session', rows)
  expect(result.map(r => r.id)).toEqual(['hermes:dev-test:1', 'hermes:dev-test:tool:call-a', 'hermes:dev-test:tool:call-b', 'hermes:dev-test:5'])
  expect(result[1].item).toEqual({ kind: 'tool', toolId: 'call-a', name: 'terminal', detail: 'date', running: false })
  expect(result[2].item).toMatchObject({ running: false, failed: true })
  expect(historyRows('dev-test', 'session', rows)).toEqual(result)
  expect(historyRows('dev-other', 'session', rows)[1].id).not.toBe(result[1].id)
})
