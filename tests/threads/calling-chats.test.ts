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

test('non-LilBot tools are not kept, and argument keys are order-independent', async () => {
  const calls = new CallingChats(50)
  const since = Date.now()
  calls.saw('b', 'main', WORK, { requestId: 'r1', title: 'x' })
  calls.saw('b', 'shell', 'terminal', { requestId: 'r4', command: 'ls' })
  expect(await calls.find('b', 'lilbot_work', 'r1')).toBe('main')
  expect(calls.starts('b', 'terminal', since)).toEqual([])
  expect(calls.starts('b', 'lilbot_work', since)).toEqual([{ chatId: 'main', args: argsKey({ title: 'x', requestId: 'r1' }), requestId: 'r1' }])
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

test('per-bot engine tool names match system, T3 and service tools while refusing spoofs and other engines’ prefixes', async () => {
  const calls = new CallingChats(50, (botId, server, tool) => (botId === 'bot-a' ? `a::${server}::${tool}` : `b/${server}/${tool}`))
  const since = Date.now()
  calls.saw('bot-a', 'a-chat', 'a::lilbot_system::lilbot_work', { requestId: 'ra' }, 'a1')
  calls.saw('bot-b', 'b-chat', 'b/lilbot_system/lilbot_work', { requestId: 'rb' }, 'b1')
  calls.saw('bot-a', 'a-t3', 'a::lilbot_t3::t3_thread_launch', { title: 'x' }, 'a2')
  calls.saw('bot-a', 'a-svc', 'a::lilbot_c_svc::echo', { text: 'hi' }, 'a3')
  // Spoofs and cross-engine prefixes must not match.
  calls.saw('bot-a', 'evil-1', 'a::lilbot_c_evil::lilbot_work', { requestId: 'spoof-a' }, 's1')
  calls.saw('bot-a', 'evil-2', 'mcp__lilbot_system__lilbot_work', { requestId: 'spoof-hermes' }, 's2')
  calls.saw('bot-a', 'evil-3', 'b/lilbot_system/lilbot_work', { requestId: 'spoof-b' }, 's3')
  calls.saw('bot-a', 'evil-4', 'a::lilbot_c_evil::t3_thread_launch', { title: 'evil' }, 's4')
  expect(await calls.find('bot-a', 'lilbot_work', 'ra')).toBe('a-chat')
  expect(await calls.find('bot-b', 'lilbot_work', 'rb')).toBe('b-chat')
  expect(calls.take('bot-a', 't3_thread_launch', since, argsKey({ title: 'x' }), null)).toBe('a-t3')
  expect(calls.take('bot-a', 'a::lilbot_c_svc::echo', since, argsKey({ text: 'hi' }), null)).toBe('a-svc')
  expect(calls.take('bot-a', 'a::lilbot_c_other::echo', since, argsKey({ text: 'hi' }), null)).toBeNull()
  expect(await refusal(calls.find('bot-a', 'lilbot_work', 'spoof-a'))).toBe('session_unknown')
  expect(await refusal(calls.find('bot-a', 'lilbot_work', 'spoof-hermes'))).toBe('session_unknown')
  expect(await refusal(calls.find('bot-a', 'lilbot_work', 'spoof-b'))).toBe('session_unknown')
  expect(calls.take('bot-a', 't3_thread_launch', since, argsKey({ title: 'evil' }), null)).toBeNull()
})
