import { expect, test } from 'bun:test'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { openDatabase } from '../../server/database/database'
import { RoutineScheduler } from '../../server/routines/routine-scheduler'
import type { RoutineService } from '../../server/routines/routine-service'

function setup() {
  const db = openDatabase(':memory:')
  const store = new ActivityStore(db)
  let changes = 0
  const activity = new ActivityService(store, () => changes++, 10)
  return { db, store, activity, changes: () => changes }
}

test('working, tool, waiting, failure and timed settlement', async () => {
  const { db, activity } = setup()
  activity.observe({ botId: 'b', chatId: 'c', key: '1', status: 'working', tool: 'terminal' })
  expect(activity.state('b')).toMatchObject({ status: 'working', text: 'Running commands', machine: 'leader' })
  activity.observe({ botId: 'b', chatId: 'c', key: '2', status: 'waiting' })
  expect(activity.state('b').status).toBe('waiting')
  activity.observe({ botId: 'b', chatId: 'c', key: '3', status: 'failed' })
  expect(activity.state('b').status).toBe('failed')
  await Bun.sleep(20)
  expect(activity.state('b').status).toBe('idle')
  activity.close()
  db.close()
})

test('unread is shared, durable, manually settable, and replay is idempotent', () => {
  const { db, store, activity, changes } = setup()
  const event = { botId: 'b', chatId: 'c', key: 'epoch:1', status: 'finished', spoke: true } as const
  activity.observe(event)
  expect(activity.state('b').unread).toBe(true)
  const unview = activity.view('b')
  const second = activity.view('b')
  expect(activity.state('b').unread).toBe(false)
  activity.observe(event)
  unview()
  activity.observe({ ...event, key: 'epoch:2' })
  expect(activity.state('b').unread).toBe(false)
  second()
  activity.observe({ ...event, key: 'epoch:3' })
  expect(activity.state('b').unread).toBe(true)
  activity.close()
  const restarted = new ActivityService(store, () => {})
  expect(restarted.state('b')).toMatchObject({ status: 'idle', unread: true })
  restarted.setUnread('b', false)
  restarted.observe({ ...event, key: 'epoch:3' })
  expect(restarted.state('b').unread).toBe(false)
  restarted.setUnread('b', true)
  expect(restarted.state('b').unread).toBe(true)
  expect(changes()).toBeGreaterThan(0)
  restarted.close()
  db.close()
})

test('another working session outlives a completed one', async () => {
  const { db, activity } = setup()
  activity.observe({ botId: 'b', chatId: 'one', key: '1', status: 'working' })
  activity.observe({ botId: 'b', chatId: 'two', key: '1', status: 'finished' })
  await Bun.sleep(20)
  expect(activity.state('b').status).toBe('working')
  activity.close()
  db.close()
})

/** The rules a session that needs Oscar (waiting for him, or failed) follows, with no text spoken. */
async function needsOscarRules(status: 'waiting' | 'failed') {
  const { db, store, activity } = setup()
  const event = { botId: 'b', chatId: 'c', status } as const
  const stopViewing = activity.view('b')
  activity.observe({ ...event, key: 'e:1' })
  expect(activity.state('b').unread).toBe(false)
  stopViewing()
  // Engines resend the status with every later event: Oscar already saw this one.
  activity.observe({ ...event, key: 'e:2' })
  expect(activity.state('b').unread).toBe(false)
  activity.observe({ botId: 'b', chatId: 'c', key: 'e:3', status: 'working' })
  activity.observe({ ...event, key: 'e:4' })
  expect(activity.state('b').unread).toBe(true)
  activity.setUnread('b', false)
  await Bun.sleep(20)
  activity.observe({ ...event, key: 'e:5' })
  expect(activity.state('b').unread).toBe(false)
  activity.close()
  const restarted = new ActivityService(store, () => {})
  restarted.observe({ ...event, key: 'e:5' })
  expect(restarted.state('b').unread).toBe(false)
  restarted.close()
  db.close()
}

test('a turn that ends waiting for Oscar turns unread on, once, unless he is viewing', () => needsOscarRules('waiting'))

test('a failed turn turns unread on, once, unless he is viewing', () => needsOscarRules('failed'))

test('a failed routine run turns unread on unless he is viewing, and an exchange between bots never does', async () => {
  const { db, activity } = setup()
  const failing = (id: string) =>
    new RoutineScheduler(
      { store: { claimDue: () => [], pending: () => [{ id, botId: 'b' }] }, run: async () => ({ status: 'failed', text: 'Broke' }) } as unknown as RoutineService,
      event => activity.observe(event)
    )
  const stopViewing = activity.view('b')
  failing('r1').tick()
  await Bun.sleep(5)
  expect(activity.state('b')).toMatchObject({ status: 'failed', unread: false })
  stopViewing()
  failing('r2').tick()
  await Bun.sleep(5)
  expect(activity.state('b')).toMatchObject({ status: 'failed', unread: true })
  activity.setUnread('b', false)
  activity.observe({ botId: 'b', chatId: 'thread:1', key: '1:true', status: 'working' })
  activity.observe({ botId: 'b', chatId: 'thread:1', key: '1:false', status: 'finished' })
  expect(activity.state('b').unread).toBe(false)
  activity.close()
  db.close()
})
