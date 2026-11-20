import { expect, test } from 'bun:test'
import { WorkCheckRunner } from '../../server/work/work-check-runner'
import { LilBotError } from '../../shared/protocol'
import type { EvidenceInput } from '../../shared/work-schema'
import { workFixture } from './work-fixture'

const proof = { proves: 'The site shows version 7', url: 'https://example.com/version' }
const saw = { proves: 'The page I opened', command: 'curl -s https://example.com/version', output: 'version 6' }
const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => '',
    (error: Error & { code?: string }) => error.code ?? error.message
  )

/** A workFixture whose check runs stay open until released, so the checking bot can give its verdict meanwhile. */
function fixture() {
  const f = workFixture()
  let release = () => {}
  f.run.result = new Promise(resolve => {
    release = () => resolve({ status: 'completed' })
  })
  return { ...f, release: () => release() }
}
type F = ReturnType<typeof fixture>
/** `a` opens a deploy (level 2) and finishes it. */
async function finish(f: F, extra: Record<string, unknown> = {}) {
  const item = await f.open('a', { kind: 'deploy', ...extra })
  return f.work.act('a', { requestId: `fin-${item.id}`, itemId: item.id, status: 'done', result: 'Version 7 is live', evidence: [proof] })
}
/** Runs the open check and gives `verdict` as the checking bot, from its check session. */
async function check(f: F, itemId: string, verdict: 'verified' | 'not_verified' | 'could_not_check', evidence: EvidenceInput[] = [saw]) {
  f.checkRuns.tick()
  await Bun.sleep(1)
  const open = f.work.checks.open(itemId)!
  f.state.chats.set(open.by.id!, `check-${open.id}-session`)
  return f.work.act(open.by.id!, { requestId: `v-${open.id}`, itemId, verdict, result: `I read version ${verdict === 'verified' ? 7 : 6}`, evidence })
}

test('a level 2 item is not done when its owner finishes: another bot LilBot chose checks it in a hidden session', async () => {
  const f = fixture()
  const item = await finish(f)
  expect(item).toMatchObject({ status: 'checking', finishedAt: null, check: { state: 'checking', by: { kind: 'bot', id: 'b', name: 'B' }, round: 1 } })
  f.checkRuns.tick()
  await Bun.sleep(1)
  expect(f.state.runs).toEqual([{ botId: 'b', prompt: expect.stringContaining('<work-claim>'), runId: `check-${item.id}:check:1` }])
  expect(f.state.runs[0].prompt).toContain('"claim":"Version 7 is live","evidence":[{"proves":"The site shows version 7"')
  expect(f.state.runs[0].prompt).toContain(`lilbot_work: itemId ${item.id}, verdict`)
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
  expect(() => f.board.answer(item.id, 'Fine')).toThrow('pass it or send it back')
  const passed = f.board.pass(item.id, 'Looked myself')
  expect(passed).toMatchObject({ status: 'done', check: { state: 'passed', by: { kind: 'oscar' }, text: 'Looked myself' } })
  expect(passed.checks.map(c => c.state)).toEqual(['not_verified', 'not_verified', 'passed'])
  expect(f.state.waits.at(-1)).toMatchObject({ on: false })
})

test('with no other bot, a level 2 item waits for Oscar with a note; level 3 always does; he passes or sends it back', async () => {
  const f = fixture()
  f.state.checkers = [{ id: 'a', name: 'A' }]
  const alone = await finish(f)
  expect(alone).toMatchObject({
    status: 'needs_oscar',
    question: expect.stringContaining('No second bot'),
    check: { by: { kind: 'oscar' }, note: expect.stringContaining('No second bot') }
  })
  expect(f.board.sendBack(alone.id, 'Version 7 is not live yet')).toMatchObject({ status: 'working', check: { state: 'sent_back' } })
  f.answers.tick()
  await Bun.sleep(1)
  expect(f.delivered.at(-1)?.prompt).toContain('Version 7 is not live yet')
  expect(() => f.board.pass(alone.id)).toThrow('not waiting for your check')
  f.state.checkers = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' }
  ]
  const asking = await f.open('a', { kind: 'deploy', level: 3 })
  await f.work.act('a', { requestId: 'ask', itemId: asking.id, status: 'needs_oscar', question: 'Which site?' })
  await f.work.act('a', { requestId: 'fin', itemId: asking.id, status: 'done', result: 'Live', evidence: [proof] })
  expect(f.state.waits.filter(w => w.itemId === asking.id).map(w => w.on)).toEqual([true, true])
  const level3 = await finish(f, { level: 3 })
  expect(level3).toMatchObject({ status: 'needs_oscar', question: expect.stringContaining('pass it or send it back'), check: { by: { kind: 'oscar' }, note: null } })
  expect(f.board.pass(level3.id).status).toBe('done')
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
