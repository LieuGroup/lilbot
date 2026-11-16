import { expect, test } from 'bun:test'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { openDatabase } from '../../server/database/database'

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
