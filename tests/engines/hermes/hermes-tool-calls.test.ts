import { expect, test } from 'bun:test'
import type { ToolCallSeen } from '../../../server/engines/bot-engine'
import { onToolCall, reportReplay, reportToolCall } from '../../../server/engines/hermes/hermes-tool-calls'

const start = (id: string, requestId: string) => ({ type: 'tool.start', payload: { tool_id: id, name: 'mcp__lilbot_system__lilbot_work', args: { requestId } } })

test('a tool start carries the engine’s call id; a replay reports only calls still under way, and nothing from an idle session', () => {
  const seen: ToolCallSeen[] = []
  const stop = onToolCall(call => seen.push(call))
  try {
    reportToolCall('', 'chat', 'tool.start', start('t0', 'r0').payload)
    expect(seen).toEqual([{ engineBotId: 'default', chatId: 'chat', tool: 'mcp__lilbot_system__lilbot_work', args: { requestId: 'r0' }, callId: 't0' }])
    seen.length = 0
    // A first read after a restart replays starts from long ago: those that completed were answered already.
    reportReplay('p', 'chat', [start('t1', 'r1'), { type: 'tool.complete', payload: { tool_id: 't1' } }, start('t2', 'r2'), { type: 'message.delta', payload: {} }], false)
    expect(seen.map(call => [call.engineBotId, call.callId])).toEqual([['p', 't2']])
    seen.length = 0
    reportReplay('p', 'chat', [start('t3', 'r3')], true)
    expect(seen).toEqual([])
  } finally {
    stop()
  }
})
