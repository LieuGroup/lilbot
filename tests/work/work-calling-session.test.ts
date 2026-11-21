/** Each caller of the calling-session match (#174) with the real matcher: a call is credited only to the session that made it. */
import { afterAll, expect, test } from 'bun:test'
import { CallingChats } from '../../server/threads/calling-chats'
import { delegationFixture, removeFixtureFolders } from '../threads/delegation-fixture'
import { proof, refusal, saw } from './work-check-fixture'
import { workFixture } from './work-fixture'

afterAll(removeFixtureFolders)
const WORK = 'mcp__lilbot_system__lilbot_work'

/** `a` finishes a level 2 deploy from its main conversation with request id `r1`; with no other bot, a fresh session of `a` checks it. */
async function sameBotCheck() {
  const calls = new CallingChats(300)
  const f = workFixture({ calls })
  f.state.checkers = [{ id: 'a', name: 'A' }]
  f.run.result = new Promise(() => {})
  const act = (chat: string, input: Record<string, unknown>) => {
    calls.saw('a', chat, WORK, input, crypto.randomUUID())
    return f.work.act('a', input as never)
  }
  const item = await act('a-main', { requestId: 'r0', title: 'Ship v7', kind: 'deploy', done: 'v7 is live' })
  await act('a-main', { requestId: 'r1', itemId: item.id, status: 'done', result: 'Version 7 is live', evidence: [proof] })
  f.checkRuns.tick()
  await Bun.sleep(1)
  return { f, calls, item, act, checkChat: `check-${item.id}:check:1-session` }
}

test('a same-bot checker reusing the owner’s request id gets its verdict in, though its start comes after the call (#174)', async () => {
  const { f, calls, item, checkChat } = await sameBotCheck()
  const verdict = { requestId: 'r1', itemId: item.id, verdict: 'verified', result: 'I read version 7', evidence: [saw] }
  const given = f.work.act('a', verdict as never)
  setTimeout(() => calls.saw('a', checkChat, WORK, verdict, 'late'), 50)
  expect(await given).toMatchObject({ status: 'done', check: { state: 'verified', sameBot: true } })
})

test('the owner’s conversation cannot pass a verdict off as the check session’s, and a call two sessions could have made is refused', async () => {
  const { f, calls, item, act, checkChat } = await sameBotCheck()
  const verdict = { requestId: 'v', itemId: item.id, verdict: 'verified', result: 'Fine', evidence: [saw] }
  expect(await refusal(act('a-main', verdict))).toBe('work_forbidden')
  calls.saw('a', checkChat, WORK, verdict, 'c1')
  calls.saw('a', 'a-main', WORK, verdict, 'm1')
  expect(await refusal(f.work.act('a', verdict as never))).toBe('session_unknown')
  expect(await refusal(act(checkChat, { requestId: 'r9', itemId: item.id, status: 'done', result: 'x', evidence: [proof] }))).toBe('work_check_session')
  expect(f.work.view(item.id).status).toBe('checking')
})

test('an item opened by a routine run is not credited to Oscar’s conversation when the run’s start is late (#174)', async () => {
  const calls = new CallingChats(300)
  const f = workFixture({ calls })
  f.database.exec("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('a', 'A', '', '', 'test', 'a')")
  f.routineStore.create('a', { requestId: 'daily', description: 'Check sales', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'oscar' }, 0, 5)
  const [run] = f.routineStore.claimDue(Date.now() + 1_000_000)
  f.routineStore.attach(run.id, 'run-session', Date.now())
  calls.saw('a', 'a-main', 'mcp__lilbot_system__lilbot_give_file', { requestId: 'r1' }, 'g1')
  const open = { requestId: 'r1', title: 'Sales report', kind: 'file', done: 'report.md exists' }
  const opening = f.work.act('a', open as never)
  setTimeout(() => calls.saw('a', 'run-session', WORK, open, 'w1'), 50)
  expect(await opening).toMatchObject({ origin: { kind: 'routine_run', id: run.id }, askedBy: { kind: 'routine', name: 'Check sales' } })
  expect(await refusal(f.work.act('a', { ...open, requestId: 'unseen' } as never))).toBe('session_unknown')
})

test('a group session’s own start decides: a later group start from it is nested and refused, not taken for the main conversation (#174)', async () => {
  const calls = new CallingChats(300)
  const f = delegationFixture({ calls })
  const first = { action: 'start', requestId: 'g1', purpose: 'Pick a name', members: ['b', 'c'], text: 'One name each.' }
  calls.saw('a', 'a-main', 'mcp__lilbot_system__lilbot_group', first, 'a1')
  await f.groups.act('a', first as never)
  await f.settle()
  const member = f.runs.find(r => r.botId === 'b')!
  // b's main conversation used the same request id for the work board a moment ago.
  calls.saw('b', 'b-main', WORK, { requestId: 'n' }, 'b1')
  const nested = { action: 'start', requestId: 'n', purpose: 'Nested', members: ['c', 'd'], text: 'Hi' }
  const starting = refusal(f.groups.act('b', nested as never))
  setTimeout(() => calls.saw('b', member.chatId, 'mcp__lilbot_system__lilbot_group', nested, 'b2'), 50)
  expect(await starting).toBe('group_nested')
})
