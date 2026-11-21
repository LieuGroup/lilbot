import { expect, test } from 'bun:test'
import { argsKey, CallingChats } from '../../server/threads/calling-chats'
import { LilBotError } from '../../shared/lilbot-error'

const WORK = 'mcp__lilbot_system__lilbot_work'
const refusal = (promise: Promise<unknown>) => promise.then(() => null).catch(error => (error instanceof LilBotError ? error.code : String(error)))

test('a reused request id waits for its own late start instead of taking the earlier session’s (#174)', async () => {
  const calls = new CallingChats(500)
  calls.saw('b', 'owner-main', WORK, { requestId: 'r1' }, 'call-1')
  expect(await calls.find('b', 'lilbot_work', 'r1')).toBe('owner-main')
  const found = calls.find('b', 'lilbot_work', 'r1')
  setTimeout(() => calls.saw('b', 'check-session', WORK, { requestId: 'r1' }, 'call-2'), 50)
  expect(await found).toBe('check-session')
})

test('a late start is still its own call’s; with none in time, or two sessions that could have made it, the call is refused, never guessed', async () => {
  const calls = new CallingChats(300)
  const late = calls.find('b', 'lilbot_work', 'r2')
  setTimeout(() => calls.saw('b', 'routine-run', WORK, { requestId: 'r2' }, 'call-3'), 150)
  expect(await late).toBe('routine-run')
  expect(await refusal(calls.find('b', 'lilbot_work', 'nobody'))).toBe('session_unknown')
  calls.saw('b', 'one', WORK, { requestId: 'r3' }, 'call-4')
  calls.saw('b', 'two', WORK, { requestId: 'r3' }, 'call-5')
  expect(await refusal(calls.find('b', 'lilbot_work', 'r3'))).toBe('session_unknown')
})

test('one start is one call: matched once, and one call reported twice (a chat and the observer, under either alias) counts once', async () => {
  const calls = new CallingChats(100)
  calls.saw('b', 'live-id', WORK, { requestId: 'r1' }, 'call-1')
  calls.saw('b', 'stored-id', WORK, { requestId: 'r1' }, 'call-1')
  expect(await calls.find('b', 'lilbot_work', 'r1')).toBe('live-id')
  expect(await refusal(calls.find('b', 'lilbot_work', 'r1'))).toBe('session_unknown')
  // A retry is a new call with a new start.
  calls.saw('b', 'live-id', WORK, { requestId: 'r1' }, 'call-2')
  expect(await calls.find('b', 'lilbot_work', 'r1')).toBe('live-id')
})

test('the tool must match, and so must the bot; a start long before the call is an earlier call’s', async () => {
  const calls = new CallingChats(50)
  calls.saw('b', 'routine-run', 'mcp__lilbot_system__lilbot_give_file', { requestId: 'r1' })
  calls.saw('b', 'routine-run', 'mcp__lilbot_system__lilbot_work_list', { requestId: 'r1' })
  calls.saw('other', 'their-chat', WORK, { requestId: 'r1' })
  expect(await refusal(calls.find('b', 'lilbot_work', 'r1'))).toBe('session_unknown')
  expect(await calls.find('b', 'lilbot_give_file', 'r1')).toBe('routine-run')
  const now = Date.now()
  const realNow = Date.now
  Date.now = () => now - 20_000
  calls.saw('b', 'old', WORK, { requestId: 'r9' })
  Date.now = realNow
  expect(await refusal(calls.find('b', 'lilbot_work', 'r9'))).toBe('session_unknown')
})

test('tool search wrappers are read, a batch entry by entry; other tools are not kept', async () => {
  const calls = new CallingChats(50)
  const since = Date.now()
  calls.saw('b', 'wrapped', 'tool_call', { name: WORK, arguments: JSON.stringify({ requestId: 'r1', title: 'x' }) })
  calls.saw('b', 'batch', 'tool_call', {
    calls: [
      { name: 'mcp__lilbot_system__lilbot_delegate', arguments: { requestId: 'r2' } },
      { name: 'mcp__lilbot_system__lilbot_group', arguments: '{"requestId":"r3"}' }
    ]
  })
  calls.saw('b', 'shell', 'terminal', { requestId: 'r4', command: 'ls' })
  expect(await calls.find('b', 'lilbot_work', 'r1')).toBe('wrapped')
  expect([await calls.find('b', 'lilbot_delegate', 'r2'), await calls.find('b', 'lilbot_group', 'r3')]).toEqual(['batch', 'batch'])
  expect(calls.starts('b', 'terminal', since)).toEqual([])
  expect(calls.starts('b', 'lilbot_work', since)).toEqual([{ chatId: 'wrapped', args: argsKey({ title: 'x', requestId: 'r1' }), requestId: 'r1' }])
  expect(argsKey({ b: [1, { d: 2, c: 3 }], a: null })).toBe(argsKey({ a: null, b: [1, { c: 3, d: 2 }] }))
})

test('outside MCP service tools cannot spoof LilBot system or T3 tool starts (M4)', async () => {
  const calls = new CallingChats(50)
  const since = Date.now()
  calls.saw('b', 'evil-chat', 'mcp__lilbot_c_evil__lilbot_work', { requestId: 'spoof-1' }, 'c1')
  calls.saw('b', 'evil-chat', 'mcp__other__lilbot_work', { requestId: 'spoof-2' }, 'c2')
  calls.saw('b', 'evil-chat', 'mcp__lilbot_c_evil__t3_thread_launch', { title: 'x' }, 'c3')
  calls.saw('b', 'svc-chat', 'mcp__lilbot_c_svc__echo', { text: 'hi' }, 'c4')
  expect(await refusal(calls.find('b', 'lilbot_work', 'spoof-1'))).toBe('session_unknown')
  expect(await refusal(calls.find('b', 'lilbot_work', 'spoof-2'))).toBe('session_unknown')
  expect(calls.starts('b', 'lilbot_work', since)).toEqual([])
  expect(calls.take('b', 't3_thread_launch', since, argsKey({ title: 'x' }), null)).toBeNull()
  expect(calls.take('b', 'mcp__lilbot_c_svc__echo', since, argsKey({ text: 'hi' }), null)).toBe('svc-chat')
  expect(calls.take('b', 'mcp__lilbot_c_other__echo', since, argsKey({ text: 'hi' }), null)).toBeNull()
})
