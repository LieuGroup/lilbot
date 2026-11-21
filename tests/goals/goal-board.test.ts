import { expect, test } from 'bun:test'
import { CallingChats } from '../../server/threads/calling-chats'
import { goalFixture } from './goal-fixture'

async function agreed() {
  const f = goalFixture()
  const goal = await f.propose()
  const detail = await f.goalBoard.agree(goal.id)
  return { f, goal: detail }
}

test("Oscar's agreement starts the goal: LilBot makes its review routine and tells the bot to open its work items", async () => {
  const { f, goal } = await agreed()
  expect(goal).toMatchObject({ state: 'agreed', waitsForOscar: false })
  expect(goal.agreedAt).toBeNumber()
  const [routine] = f.routineStore.list('a')
  expect(goal.routineId).toBe(routine.id)
  expect(routine).toMatchObject({ createdBy: 'oscar', schedule: { kind: 'interval', seconds: 600 }, paused: false })
  expect(routine.description).toContain(`goalId ${goal.id}`)
  const [notice] = f.notices()
  expect(notice).toMatchObject({ about: goal.id, botId: 'a', chatId: null })
  expect(notice.text).toContain('Oscar agreed your goal')
  expect(notice.text).toContain('Ideas for the lines')
  expect(f.g.waits.map(w => w.on)).toEqual([true, false])
  // The review routine is not one of the bot's own five.
  for (let n = 0; n < 5; n++)
    f.routineStore.create('a', { requestId: `own-${n}`, description: 'mine', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'bot' }, Date.now(), 5)
  const item = await f.open('a', { goalId: goal.id })
  expect(item.goalId).toBe(goal.id)
  expect(f.goals.view(goal.id).items.map(i => i.id)).toEqual([item.id])
  await expect(f.goalBoard.agree(goal.id)).rejects.toThrow(/Nothing about this goal waits/)
  await f.propose()
  expect(f.goalBoard.list({ botId: 'a', state: ['agreed'] }).map(g => g.id)).toEqual([goal.id])
  expect(f.goalBoard.list({ state: ['proposed', 'agreed'] })).toHaveLength(2)
  expect(f.goalBoard.list({ botId: 'b' })).toEqual([])
})

test('a review is a work item with the reading as evidence, checked as a figure; the goal is reached only once it is done', async () => {
  const { f, goal } = await agreed()
  await f.open('a', { goalId: goal.id })
  const fromChat = { action: 'progress' as const, requestId: 'chat', goalId: goal.id, value: 7, did: 'x', evidence: [{ proves: 'p', command: 'wc -l n', output: '7 n' }] }
  await expect(f.goals.act('a', fromChat)).rejects.toThrow(/only in the goal's review routine/)
  const first = await f.progress(goal.id, 7)
  expect(first.latest).toMatchObject({ value: 7, previous: 3, moved: 'toward', met: false, stalled: false, did: 'Wrote the lines I said', work: { open: 1, done: 0 } })
  const review = f.work.view(first.latest!.itemId)
  expect(review).toMatchObject({ goalId: goal.id, kind: 'figure', checkLevel: 2, status: 'checking', check: { by: { kind: 'bot', id: 'b' } } })
  expect([review.origin.kind, review.askedBy]).toEqual(['routine_run', { kind: 'routine', id: goal.routineId, name: expect.stringContaining('Review of your goal') }])
  expect(review.evidence.map(e => e.pointer.kind)).toEqual(['number', 'command'])
  expect(review.evidence[0].pointer).toMatchObject({ value: '7', source: '/w/a/notes.txt' })
  expect(review.result).toContain('Number: lines in notes.txt is 7 (previous 3, baseline 3, target 10')
  expect(review.result).toContain('Work: Wrote the lines I said (items for the goal: 0 done, 1 under way')
  f.work.levels.set('figure', undefined, 3)
  const met = await f.progress(goal.id, 10)
  expect(met.latest).toMatchObject({ met: true, previous: 7, work: { open: 1 } })
  await f.reviews.tick()
  expect(f.goals.view(goal.id).state).toBe('agreed')
  f.board.pass(met.latest!.itemId)
  await f.reviews.tick()
  const reached = f.goals.view(goal.id)
  expect(reached).toMatchObject({ state: 'reached', routineId: null })
  expect(reached.events.at(-1)).toMatchObject({ by: 'lilbot', kind: 'reached' })
  expect(f.routineStore.list('a')).toEqual([])
  await expect(f.progress(goal.id, 11)).rejects.toThrow(/This goal is reached/)
})

test('when nothing moves the review must propose a change; Oscar agrees and the new target and rhythm apply', async () => {
  const { f, goal } = await agreed()
  await f.progress(goal.id, 3)
  await expect(f.progress(goal.id, 3)).rejects.toThrow(/has not moved toward the target in two reviews/)
  const target = {
    measure: 'lines in notes.txt',
    source: '/w/a/notes.txt',
    baseline: 3,
    evidence: { proves: 'count', command: 'wc -l /w/a/notes.txt', output: '3' },
    value: 5,
    due: '2099-01-01'
  }
  const stalled = await f.progress(goal.id, 3, { target, review: { kind: 'interval', seconds: 1200 }, why: 'Ten is too far for now' })
  expect(stalled).toMatchObject({ waitsForOscar: true, latest: { stalled: true, moved: 'none' }, proposal: { why: 'Ten is too far for now', drop: false, target: { value: 5 } } })
  expect(f.work.view(stalled.latest!.itemId).result).toContain('Nothing moves')
  const old = goal.routineId
  const changed = await f.goalBoard.agree(goal.id)
  expect(changed).toMatchObject({ proposal: null, waitsForOscar: false, target: { value: 5 }, review: { seconds: 1200 } })
  expect(changed.routineId).not.toBe(old)
  expect(f.routineStore.list('a').map(r => r.schedule)).toEqual([{ kind: 'interval', seconds: 1200 }])
  expect(f.notices().at(-1).text).toContain('Oscar agreed your proposed change')
})

test("pausing pauses the review routine and the bot's work for it; agreeing resumes; a routine the bot removed is put back", async () => {
  const { f, goal } = await agreed()
  const paused = await f.goalBoard.pause(goal.id)
  expect(paused.state).toBe('paused')
  expect(f.routineStore.get('a', goal.routineId!).paused).toBe(true)
  await expect(f.open('a', { goalId: goal.id })).rejects.toThrow(/This goal is paused/)
  expect(f.notices().at(-1).text).toContain('Oscar paused your goal')
  await f.goalBoard.agree(goal.id)
  expect(f.routineStore.get('a', goal.routineId!).paused).toBe(false)
  await f.routines.delete('a', goal.routineId!)
  await f.reviews.tick()
  const back = f.goals.view(goal.id)
  expect(back.routineId).not.toBe(goal.routineId)
  expect(f.routineStore.list('a').map(r => r.id)).toEqual([back.routineId as string])
})

test('dropping ends the goal, removes its routine and drops its unfinished items, which tells the bot', async () => {
  const { f, goal } = await agreed()
  const item = await f.open('a', { goalId: goal.id })
  const before = f.notices().length
  const dropped = await f.goalBoard.drop(goal.id, 'Not needed any more')
  expect(dropped).toMatchObject({ state: 'dropped', dropReason: 'Not needed any more', routineId: null })
  expect(f.routineStore.list('a')).toEqual([])
  expect(f.work.view(item.id)).toMatchObject({ status: 'dropped', dropReason: 'Oscar dropped the goal "Grow notes.txt to 10 lines": Not needed any more' })
  expect(f.notices().length).toBe(before)
  expect(f.database.query('SELECT 1 FROM work_answers WHERE id = ?').get(`drop-${item.id}`)).toBeTruthy()
  expect((await f.goalBoard.drop(goal.id)).events.filter(e => e.kind === 'dropped').length).toBe(1)
  // With no items left to drop, the bot gets the goal's own notice.
  const other = await f.goalBoard.agree((await f.propose()).id)
  await f.goalBoard.drop(other.id)
  expect(f.notices().at(-1)).toMatchObject({ about: other.id })
  expect(f.notices().at(-1).text).toContain('Oscar dropped your goal')
})

test('a proposal to drop is agreed by dropping; adjusting an agreed goal clears a proposal and asks the bot for a change', async () => {
  const { f, goal } = await agreed()
  await f.goals.act('a', { action: 'propose', requestId: 'drop-it', goalId: goal.id, drop: true, why: 'Oscar has no use for it' })
  await f.goalBoard.adjust(goal.id, 'Keep it, but by March')
  expect(f.goals.view(goal.id)).toMatchObject({ state: 'agreed', proposal: null, oscar: 'Keep it, but by March' })
  expect(f.notices().at(-1).text).toContain('Oscar wants a change')
  await f.goals.act('a', { action: 'propose', requestId: 'drop-again', goalId: goal.id, drop: true, why: 'Still no use' })
  expect((await f.goalBoard.agree(goal.id)).state).toBe('dropped')
})

test("a deleted bot's goals end with it", async () => {
  const { f, goal } = await agreed()
  f.goals.forgetBot('a')
  expect(f.goals.view(goal.id)).toMatchObject({ state: 'dropped', dropReason: 'The bot was deleted.', botName: 'A' })
})

test('a review matched to its routine run becomes its work item in the same call, with no second start to match (#174)', async () => {
  const f = goalFixture({ calls: new CallingChats(300) })
  const goal = await f.goalBoard.agree((await f.propose()).id)
  const reviewed = await f.progress(goal.id, 7)
  expect(reviewed.latest).toMatchObject({ value: 7, moved: 'toward' })
  expect(f.work.view(reviewed.latest!.itemId)).toMatchObject({ kind: 'figure', origin: { kind: 'routine_run' } })
})
