import { expect, test } from 'bun:test'
import type { ToolCallSeen } from '../../../server/engines/bot-engine'
import { hermesMcpToolName } from '../../../server/engines/hermes/hermes-connections'
import { onToolCall, reportReplay, reportToolCall } from '../../../server/engines/hermes/hermes-tool-calls'
import { argsKey, CallingChats } from '../../../server/threads/calling-chats'

const WORK = 'mcp__lilbot_system__lilbot_work'
const start = (id: string, requestId: string) => ({ type: 'tool.start', payload: { tool_id: id, name: WORK, args: { requestId } } })

test('a tool start carries the engine’s call id; a replay reports only calls still under way, and nothing from an idle session', () => {
  const seen: ToolCallSeen[] = []
  const stop = onToolCall(call => seen.push(call))
  try {
    reportToolCall('', 'chat', 'tool.start', start('t0', 'r0').payload)
    expect(seen).toEqual([{ engineBotId: 'default', chatId: 'chat', tool: WORK, args: { requestId: 'r0' }, callId: 't0' }])
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

test('Hermes tool_call wrappers are unwrapped entry by entry, skip malformed JSON, and deduplicate replays in CallingChats', async () => {
  const calls = new CallingChats(50, (_botId, server, tool) => hermesMcpToolName(server, tool))
  const seen: ToolCallSeen[] = []
  const since = Date.now()
  const stop = onToolCall(call => {
    seen.push(call)
    calls.saw('b', call.chatId, call.tool, call.args, call.callId)
  })
  try {
    reportToolCall('', 'wrapped', 'tool.start', {
      tool_id: 'w1',
      name: 'tool_call',
      args: { name: WORK, arguments: JSON.stringify({ requestId: 'r1', title: 'x' }) }
    })
    const batchPayload = {
      tool_id: 'w2',
      name: 'tool_call',
      args: {
        calls: [
          { name: 'mcp__lilbot_system__lilbot_delegate', arguments: { requestId: 'r2' } },
          { name: 'mcp__lilbot_system__lilbot_group', arguments: '{"requestId":"r3"}' },
          { name: 'mcp__lilbot_system__lilbot_give_file', arguments: '{not json' },
          { name: 'terminal', arguments: { command: 'ls' } }
        ]
      }
    }
    reportToolCall('', 'batch', 'tool.start', batchPayload)
    // Duplicate replay of the same tool_call batch under another session alias must deduplicate by callId.
    reportReplay('', 'batch-stored', [{ type: 'tool.start', payload: batchPayload }], false)
    expect(seen.slice(0, 4).map(c => [c.tool, c.callId])).toEqual([
      [WORK, 'w1:0'],
      ['mcp__lilbot_system__lilbot_delegate', 'w2:0'],
      ['mcp__lilbot_system__lilbot_group', 'w2:1'],
      ['terminal', 'w2:2']
    ])
    expect(await calls.find('b', 'lilbot_work', 'r1')).toBe('wrapped')
    expect([await calls.find('b', 'lilbot_delegate', 'r2'), await calls.find('b', 'lilbot_group', 'r3')]).toEqual(['batch', 'batch'])
    expect(calls.starts('b', 'terminal', since)).toEqual([])
    expect(calls.starts('b', 'lilbot_work', since)).toEqual([{ chatId: 'wrapped', args: argsKey({ title: 'x', requestId: 'r1' }), requestId: 'r1' }])
  } finally {
    stop()
  }
})
