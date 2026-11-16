import { expect, test } from 'bun:test'
import { rmSync } from 'node:fs'
import { RoutineScheduler } from '../../server/routines/routine-scheduler'
import { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import type { RoutineCreate } from '../../shared/routine-schema'
import { fakeService } from '../helpers/fake-engine'

const input: RoutineCreate = { requestId: 'one', description: 'Write the time', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'bot' }
const flush = () => new Promise(resolve => setTimeout(resolve, 20))
function setup() {
  const fake = fakeService()
  let time = 0
  let changes = 0
  const store = new RoutineStore(fake.database)
  const service = new RoutineService(
    store,
    fake.service,
    () => changes++,
    { minIntervalSeconds: 300, selfCreatedCap: 2 },
    () => time
  )
  return {
    ...fake,
    routines: service,
    routineStore: store,
    setTime: (value: number) => {
      time = value
    },
    now: () => time,
    changes: () => changes,
    clean: () => {
      fake.database.close()
      rmSync(fake.root, { recursive: true, force: true })
    }
  }
}

test('create retries, cap including paused routines, minimum interval, and deleted request tombstone', async () => {
  const f = setup()
  try {
    const one = await f.routines.create('b1', input)
    expect((await f.routines.create('b1', input)).id).toBe(one.id)
    await f.routines.pause('b1', one.id, true)
    await f.routines.create('b1', { ...input, requestId: 'two' })
    await expect(f.routines.create('b1', { ...input, requestId: 'three' })).rejects.toThrow('at most 2')
    await expect(f.routines.create('b1', { ...input, schedule: { kind: 'interval', seconds: 60 } })).rejects.toThrow('minimum interval')
    await f.routines.create('b1', { ...input, requestId: 'oscar', createdBy: 'oscar' })
    await f.routines.delete('b1', one.id)
    await expect(f.routines.create('b1', input)).rejects.toThrow('deleted routine')
    expect((await f.routines.list('b1')).length).toBe(2)
  } finally {
    f.clean()
  }
})

test('atomic due claim catches up once, never overlaps, and survives new store/scheduler instances', async () => {
  const f = setup()
  try {
    const routine = await f.routines.create('b1', input)
    expect(f.routineStore.claimDue(299_999)).toEqual([])
    const [run] = f.routineStore.claimDue(950_000)
    expect(run.dueAt).toBe(300_000)
    expect(f.routineStore.get('b1', routine.id).nextRunAt).toBe(1_200_000)
    expect(new RoutineStore(f.database).claimDue(1_500_000)).toEqual([])
    const events: any[] = []
    f.setTime(950_000)
    const scheduler = new RoutineScheduler(f.routines, event => events.push(event), f.now)
    expect(scheduler.tick()).toEqual([run.id])
    expect(scheduler.tick()).toEqual([])
    await flush()
    expect(f.routineStore.run('b1', run.id)).toMatchObject({ status: 'completed', result: 'Done', chatId: `routine-${run.id}` })
    expect(events.at(-1)).toMatchObject({ status: 'finished', spoke: true })
    expect(f.routineStore.isRoutineChat(`routine-${run.id}`)).toBe(true)
    expect(f.prefs.mainChat('b1')).toBeNull()
  } finally {
    f.clean()
  }
})

test('pause/resume skips paused time, deletion removes schedules and history', async () => {
  const f = setup()
  try {
    const routine = await f.routines.create('b1', input)
    await f.routines.pause('b1', routine.id, true)
    expect(f.routineStore.claimDue(500_000)).toEqual([])
    f.setTime(500_000)
    await f.routines.pause('b1', routine.id, false)
    expect(f.routineStore.get('b1', routine.id).nextRunAt).toBe(800_000)
    const [run] = f.routineStore.claimDue(800_000)
    f.routineStore.attach(run.id, 'chat', 800_000)
    f.routineStore.forgetBot('b1')
    expect(f.routineStore.pending()).toEqual([])
    expect(f.routineStore.isRoutineChat('chat')).toBe(false)
  } finally {
    f.clean()
  }
})

test('failed transport retries same durable run after restart; no new execution identity', async () => {
  const f = setup()
  try {
    await f.routines.create('b1', input)
    const attempts: string[] = []
    f.engine.runRoutine = async (_id, _prompt, options) => {
      attempts.push(options.runId)
      throw new Error('offline')
    }
    f.setTime(300_000)
    new RoutineScheduler(f.routines, () => {}, f.now).tick()
    await flush()
    new RoutineScheduler(f.routines, () => {}, f.now).tick()
    await flush()
    expect(attempts.length).toBe(2)
    expect(new Set(attempts).size).toBe(1)
  } finally {
    f.clean()
  }
})

test('another bot cannot manage or open a run; unknown bots cannot create', async () => {
  const f = setup()
  try {
    const other = await f.service.createBot({ name: 'Other', function: '', instructions: '' })
    const routine = await f.routines.create('b1', input)
    const [run] = f.routineStore.claimDue(300_000)
    await expect(f.routines.pause(other.id, routine.id, true)).rejects.toThrow('does not exist')
    await expect(f.routines.delete(other.id, routine.id)).rejects.toThrow('does not exist')
    await expect(f.routines.openRun(other.id, run.id, () => {})).rejects.toThrow('does not exist')
    await expect(f.routines.create('unknown', input)).rejects.toThrow()
  } finally {
    f.clean()
  }
})

test('actual bot deletion removes schedules and run history', async () => {
  const f = setup()
  try {
    const bot = await f.service.createBot({ name: 'Delete me', function: '', instructions: '' })
    await f.routines.create(bot.id, input)
    // The main server composes this cleanup with activity and queued-review cleanup.
    const { BotService } = await import('../../server/bots/bot-service')
    const { Workspaces } = await import('../../server/bots/workspaces')
    const bots = new BotService(f.engine, f.store, f.prefs, new Workspaces(f.root), f.memory, { cleanupBot: id => f.routineStore.forgetBot(id) })
    f.routineStore.claimDue(300_000)
    await bots.deleteBot({ botId: bot.id })
    expect(f.routineStore.list(bot.id)).toEqual([])
    expect(f.routineStore.pending()).toEqual([])
    expect(f.database.query('SELECT * FROM routine_runs').all()).toEqual([])
  } finally {
    f.clean()
  }
})
