import { expect, test } from 'bun:test'
import { WorkCheckRunner } from '../../server/work/work-check-runner'
import { LilBotError } from '../../shared/lilbot-error'
import { check, finish, fixture, proof, refusal, saw } from './work-check-fixture'

test('a level 2 item is not done when its owner finishes: another bot LilBot chose checks it in a hidden session', async () => {
  const f = fixture()
  const item = await finish(f)
  expect(item).toMatchObject({ status: 'checking', finishedAt: null, check: { state: 'checking', by: { kind: 'bot', id: 'b', name: 'B' }, round: 1, sameBot: false, model: null } })
  f.checkRuns.tick()
  await Bun.sleep(1)
  expect(f.state.runs).toEqual([{ botId: 'b', prompt: expect.stringContaining('<work-claim>'), runId: `check-${item.id}:check:1` }])
  expect(f.state.runs[0].prompt).toContain('"claim":"Version 7 is live","evidence":[{"proves":"The site shows version 7"')
  expect(f.state.runs[0].prompt).toContain(`lilbot_work: requestId "verdict-${item.id}:check:1", itemId ${item.id}, verdict`)
  expect(f.state.runs[0].prompt).toContain('where its relative paths start: "/workspaces/a"')
  expect(f.work.checks.isCheckChat(`check-${item.id}:check:1-session`)).toBe(true)
  expect(f.state.activity).toEqual([['b', true]])
  f.checkRuns.tick()
  expect(f.state.runs).toHaveLength(1)
  const verified = await check(f, item.id, 'verified', [proof])
  expect(verified).toMatchObject({ status: 'done', check: { state: 'verified', by: { id: 'b' }, text: 'I read version 7' } })
  expect(verified.finishedAt).not.toBeNull()
  expect(verified.evidence.map(e => e.byId)).toEqual(['a', 'b'])
  expect(f.board.brief().done.items[0].check?.state).toBe('verified')
  f.release()
  await Bun.sleep(1)
  expect(f.work.view(item.id).checks).toHaveLength(1)
})

test('only the chosen bot gives a verdict, from its check session, with evidence; the owner cannot report meanwhile', async () => {
  const f = fixture()
  const item = await finish(f)
  expect(await refusal(f.work.act('a', { requestId: `fin-${item.id}`, itemId: item.id, status: 'done', result: 'Version 7 is live', evidence: [proof] }))).toBe('')
  expect(await refusal(f.work.act('a', { requestId: 'more', itemId: item.id, status: 'done', result: 'Really', evidence: [proof] }))).toBe('work_checking')
  f.checkRuns.tick()
  await Bun.sleep(1)
  const give = (botId: string, extra: Record<string, unknown> = {}) =>
    refusal(f.work.act(botId, { requestId: crypto.randomUUID(), itemId: item.id, verdict: 'verified', result: 'Seen', evidence: [saw], ...extra }))
  expect(await give('a')).toBe('work_forbidden')
  expect(await give('c')).toBe('work_forbidden')
  expect(await give('b')).toBe('work_forbidden')
  f.state.chats.set('b', `check-${item.id}:check:1-session`)
  expect(await give('b', { evidence: undefined })).toBe('work_no_evidence')
  expect(await give('b', { result: undefined })).toBe('work_no_result')
  expect(await refusal(f.work.act('b', { requestId: 'x', title: 'Note it', kind: 'note' }))).toBe('work_check_session')
  expect(f.work.view(item.id).status).toBe('checking')
})

test('not verified goes back to its owner once, with what the checker saw; a second failure waits for Oscar', async () => {
  const f = fixture()
  const item = await finish(f)
  const back = await check(f, item.id, 'not_verified')
  expect(back).toMatchObject({ status: 'working', check: { state: 'not_verified', text: 'I read version 6' } })
  f.answers.tick()
  await Bun.sleep(1)
  expect(f.delivered).toEqual([{ botId: 'a', prompt: expect.stringContaining('<check-finding>'), runId: `work-check-${item.id}:check:1`, chatId: null }])
  const again = await f.work.act('a', { requestId: 'fin-2', itemId: item.id, status: 'done', result: 'Fixed', evidence: [proof] })
  expect(again.check).toMatchObject({ state: 'checking', round: 2, by: { id: 'c' } })
  const oscar = await check(f, item.id, 'not_verified')
  expect(oscar).toMatchObject({ status: 'needs_oscar', question: expect.stringContaining('Two checks did not verify'), check: { state: 'checking', by: { kind: 'oscar' } } })
  expect(f.state.waits.at(-1)).toMatchObject({ botId: 'a', itemId: item.id, on: true })
  const retried = { requestId: `v-${item.id}:check:2`, itemId: item.id, verdict: 'not_verified' as const, result: 'I read version 6', evidence: [saw] }
  expect((await f.work.act('c', retried)).checks).toHaveLength(3)
  expect(() => f.board.answer(item.id, 'Fine')).toThrow('pass it or send it back')
  const passed = f.board.pass(item.id, 'Looked myself')
  expect(passed).toMatchObject({ status: 'done', check: { state: 'passed', by: { kind: 'oscar' }, text: 'Looked myself' } })
  expect(passed.checks.map(c => c.state)).toEqual(['not_verified', 'not_verified', 'passed'])
  expect(f.state.waits.at(-1)).toMatchObject({ on: false })
})

test('level 3 always waits for Oscar, who passes it or sends it back; a bot cannot answer for him', async () => {
  const f = fixture()
  const asking = await f.open('a', { kind: 'deploy', level: 3 })
  await f.work.act('a', { requestId: 'ask', itemId: asking.id, status: 'needs_oscar', question: 'Which site?' })
  await f.work.act('a', { requestId: 'fin', itemId: asking.id, status: 'done', result: 'Live', evidence: [proof] })
  expect(f.state.waits.filter(w => w.itemId === asking.id).map(w => w.on)).toEqual([true, true])
  const level3 = await finish(f, { level: 3 })
  expect(level3).toMatchObject({
    status: 'needs_oscar',
    question: expect.stringContaining('pass it or send it back'),
    check: { by: { kind: 'oscar' }, note: null, sameBot: false }
  })
  expect(f.board.sendBack(level3.id, 'Version 7 is not live yet')).toMatchObject({ status: 'working', check: { state: 'sent_back' } })
  f.answers.tick()
  await Bun.sleep(1)
  expect(f.delivered.at(-1)?.prompt).toContain('Version 7 is not live yet')
  expect(() => f.board.pass(level3.id)).toThrow('not waiting for your check')
  const again = await f.work.act('a', { requestId: 'fin-again', itemId: level3.id, status: 'done', result: 'Live now', evidence: [proof] })
  expect(f.board.pass(again.id).status).toBe('done')
})

test('a child item’s owner never checks it; a run with no verdict, or a checker gone, waits for Oscar; a drop closes the check', async () => {
  const f = fixture()
  const parent = await f.open('a', { kind: 'deploy' })
  f.links.child(parent.id, { id: 'ex1', owner: { id: 'b', name: 'B' }, asker: { id: 'a', name: 'A' }, task: 'Build it' })
  const done = await f.work.act('a', { requestId: 'p', itemId: parent.id, status: 'done', result: 'Live', evidence: [proof] })
  expect(done.check?.by.id).toBe('c')
  f.run.result = Promise.resolve({ status: 'completed' })
  f.checkRuns.tick()
  await Bun.sleep(1)
  expect(f.work.view(parent.id)).toMatchObject({
    status: 'needs_oscar',
    checks: [{ state: 'could_not_check', text: expect.stringContaining('without a verdict') }, { by: { kind: 'oscar' } }]
  })
  const gone = await finish(f)
  f.run.result = Promise.reject(new LilBotError('bot_not_found', 'That bot does not exist.'))
  f.run.result.catch(() => {})
  f.checkRuns.tick()
  await Bun.sleep(1)
  expect(f.work.view(gone.id)).toMatchObject({
    status: 'needs_oscar',
    checks: [{ state: 'could_not_check', text: 'B is no longer available to check it.' }, { by: { kind: 'oscar' } }]
  })
  const dropped = await finish(f)
  f.board.drop(dropped.id, 'Not needed')
  expect(f.work.view(dropped.id).checks[0].state).toBe('dropped')
  expect(await refusal(f.work.act('b', { requestId: 'late', itemId: dropped.id, verdict: 'verified', result: 'x', evidence: [saw] }))).toBe('work_forbidden')
})

test('after a restart the open check runs again with the same run id, so the engine finds the same admission', async () => {
  const f = fixture()
  const item = await finish(f)
  f.checkRuns.tick()
  const restarted = new WorkCheckRunner(
    f.work,
    async (botId, prompt, runId) => {
      f.state.runs.push({ botId, prompt, runId })
      return new Promise(() => {})
    },
    () => {},
    botId => botId
  )
  restarted.tick()
  expect(f.state.runs.map(run => run.runId)).toEqual([`check-${item.id}:check:1`, `check-${item.id}:check:1`])
})
