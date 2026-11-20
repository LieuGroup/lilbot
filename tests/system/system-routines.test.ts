import { expect, test } from 'bun:test'
import { addBot, systemFixture } from './system-fixture'

const daily = { kind: 'daily', time: '08:00' }
const create = { action: 'create', requestId: 'r1', description: 'Check the inbox', schedule: daily, createdBy: 'oscar' }

test('a bot schedules, pauses, resumes and deletes its own routine through its key; the caller is never an argument', async () => {
  const f = systemFixture()
  const made = (await f.call('b1', 'lilbot_routine', { ...create, botId: 'someone-else' })).data
  expect(made).toMatchObject({
    botId: 'b1',
    description: 'Check the inbox',
    createdBy: 'oscar',
    schedule: { kind: 'daily', time: '08:00', timeZone: 'Australia/Adelaide' },
    paused: false
  })
  expect((await f.call('b1', 'lilbot_routine', create)).data.id).toBe(made.id)
  expect((await f.call('b1', 'lilbot_routines_list')).data.map((routine: any) => routine.id)).toEqual([made.id])
  expect((await f.call('b1', 'lilbot_routine', { action: 'pause', id: made.id })).data).toEqual({ id: made.id, ok: true })
  expect((await f.call('b1', 'lilbot_routines_list')).data[0].paused).toBe(true)
  await f.call('b1', 'lilbot_routine', { action: 'resume', id: made.id })
  expect((await f.call('b1', 'lilbot_routines_list')).data[0].paused).toBe(false)
  expect((await f.call('b1', 'lilbot_routine', { action: 'delete', id: made.id })).data).toEqual({ id: made.id, ok: true })
  expect((await f.call('b1', 'lilbot_routines_list')).data).toEqual([])
})

test('another bot can neither see, pause nor delete the routine', async () => {
  const f = systemFixture()
  const made = (await f.call('b1', 'lilbot_routine', create)).data
  const other = await addBot(f, 'Other')
  expect((await f.call(other.id, 'lilbot_routines_list')).data).toEqual([])
  for (const action of ['pause', 'resume', 'delete']) expect((await f.call(other.id, 'lilbot_routine', { action, id: made.id })).error).toBeDefined()
  expect((await f.call('b1', 'lilbot_routines_list')).data).toHaveLength(1)
  // The same request id from another bot is its own request.
  expect((await f.call(other.id, 'lilbot_routine', create)).data.id).not.toBe(made.id)
})

test('refusals say what is missing: no id, no schedule, an interval below the minimum, the cap of five', async () => {
  const f = systemFixture()
  expect((await f.call('b1', 'lilbot_routine', { action: 'pause' })).error).toBe('Give the id of the routine to pause.')
  expect((await f.call('b1', 'lilbot_routine', { action: 'create', requestId: 'x', description: 'Check', createdBy: 'bot' })).error).toContain('schedule')
  expect((await f.call('b1', 'lilbot_routine', { ...create, requestId: 'x', schedule: { kind: 'interval', seconds: 60 } })).error).toContain('minimum interval is 300')
  for (let i = 0; i < 5; i++) expect((await f.call('b1', 'lilbot_routine', { ...create, requestId: `own-${i}`, createdBy: 'bot' })).data.createdBy).toBe('bot')
  expect((await f.call('b1', 'lilbot_routine', { ...create, requestId: 'own-5', createdBy: 'bot' })).error).toBeDefined()
})

test('every step is logged against the routine and the list leaves no row', async () => {
  const f = systemFixture()
  const made = (await f.call('b1', 'lilbot_routine', create)).data
  await f.call('b1', 'lilbot_routine', { action: 'pause', id: made.id })
  await f.call('b1', 'lilbot_routines_list')
  expect(f.changes.recent(5).map(({ tool, target, fields }) => ({ tool, target, fields }))).toEqual([
    { tool: 'lilbot_routine', target: made.id, fields: 'action, id' },
    { tool: 'lilbot_routine', target: made.id, fields: 'description, schedule, createdBy, action' }
  ])
})

test('the list shows the latest five runs, each result cut to 500 characters', async () => {
  const f = systemFixture()
  await f.call('b1', 'lilbot_routine', { ...create, schedule: { kind: 'interval', seconds: 300 } })
  for (let i = 1; i <= 7; i++) {
    const [run] = f.routines.store.claimDue(1_700_000_000_000 + i * 300_000)
    f.routines.store.finish(run.id, 'completed', `run ${i} ${'x'.repeat(2000)}`, 1_700_000_000_000 + i * 300_000)
  }
  const runs = (await f.call('b1', 'lilbot_routines_list')).data[0].runs
  expect(runs.map((run: any) => run.result.slice(0, 5))).toEqual(['run 7', 'run 6', 'run 5', 'run 4', 'run 3'])
  for (const run of runs) expect(run.result).toHaveLength(500)
})
