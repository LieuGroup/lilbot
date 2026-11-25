/** Regression tests for async delivery/queue bounds, hot-path failure isolation, main-session/dual-path dedupe, and mutation guards. */
import { expect, test } from 'bun:test'
import { createNotifications } from '../../server/app-notifications'
import { openDatabase } from '../../server/database/database'
import { DeviceStore } from '../../server/devices/device-store'
import { HistoryStore } from '../../server/history/history-store'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import { NotificationService } from '../../server/notifications/notification-service'
import { NotificationStore } from '../../server/notifications/notification-store'
import type { WorkSummary } from '../../shared/work-schema'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const D1 = '44444444-4444-4444-8444-444444444444'
const D2 = '55555555-5555-4555-8555-555555555555'

function workFixture(overrides: Partial<WorkSummary & { chatId?: string | null }> = {}): WorkSummary & { chatId?: string | null } {
  return {
    id: 'w-async',
    title: 'Long job',
    ownerId: 'b1',
    ownerName: 'Bot One',
    askedBy: { kind: 'oscar', id: null, name: 'Oscar' },
    origin: { kind: 'conversation', id: 'chat-1' },
    chatId: 'chat-1',
    parentId: null,
    goalId: null,
    kind: 'code',
    checkLevel: 1,
    defaultLevel: 1,
    check: null,
    status: 'done',
    question: null,
    evidenceCount: 1,
    createdAt: 0,
    updatedAt: 180_000,
    startedAt: 0,
    finishedAt: 180_000,
    ...overrides
  }
}

test('slow sender reserves turn suppression and cooldown before await, enforces concurrency/overflow/timeout, and prunes to row cap', async () => {
  let clock = 1_700_000_000_000
  const db = openDatabase(':memory:')
  const devices = new DeviceStore(db)
  devices.touch(D1, 'Phone', clock)
  let inFlight = 0
  let maxConcurrent = 0
  const sender = new TestNotificationSender(['test'], async () => {
    inFlight++
    maxConcurrent = Math.max(maxConcurrent, inFlight)
    await new Promise(resolve => setTimeout(resolve, 40))
    inFlight--
    return { status: 'sent' }
  })
  const store = new NotificationStore(db)
  const service = new NotificationService(store, sender, {
    deviceExists: id => Boolean(devices.get(id)),
    botName: () => 'Bot One',
    now: () => clock,
    maxConcurrent: 2,
    maxQueued: 2,
    timeoutMs: 200
  })
  service.register(D1, 'test', 'tok-async-1234', 'com.lilbot.app')

  // P1A: work_done starts slow send; reply arriving 5ms later in the same turn is suppressed synchronously.
  service.noteTurnStarted('b1', 'chat-1')
  const workPromise = service.notifyWorkFinished(workFixture(), 1)
  await new Promise(resolve => setTimeout(resolve, 5))
  const replyPromise = service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Done!', dedupeKey: 'r-race' })
  const [workRes, replyRes] = await Promise.all([workPromise, replyPromise])
  expect(workRes.sent).toBe(1)
  expect(replyRes).toEqual({ sent: 0, suppressed: 1, deduped: 0, failed: 0 })

  // P1B: 5 rapid concurrent replies against a slow sender reserve cooldown synchronously -> only 1 sends.
  sender.clear()
  clock += 60_000
  const burst = await Promise.all([1, 2, 3, 4, 5].map(n => service.notifyReply({ botId: 'b1', chatId: `c-${n}`, text: `msg ${n}`, dedupeKey: `storm-${n}` })))
  expect(burst.reduce((acc, r) => acc + r.sent, 0)).toBe(1)
  expect(sender.sent).toHaveLength(1)

  // Queue concurrency cap (2) and overflow drop (maxQueued: 2 -> 6 simultaneous urgent sends drop 2).
  sender.clear()
  maxConcurrent = 0
  const urgent = await Promise.all([1, 2, 3, 4, 5, 6].map(n => service.notifyTurnFailed({ botId: 'b1', chatId: `u-${n}`, dedupeKey: `urg-${n}` })))
  expect(maxConcurrent).toBeLessThanOrEqual(2)
  expect(urgent.reduce((acc, r) => acc + r.sent, 0)).toBe(4)
  expect(urgent.reduce((acc, r) => acc + r.failed, 0)).toBe(2)

  // Sender timeout settles as failed without hanging.
  const hanging = new NotificationService(store, new TestNotificationSender(['test'], () => new Promise(() => {})), {
    deviceExists: () => true,
    botName: () => 'Bot One',
    now: () => clock,
    timeoutMs: 25
  })
  expect(await hanging.notifyTurnFailed({ botId: 'b1', chatId: 'hang', dedupeKey: 'hang-1' })).toMatchObject({ sent: 0, failed: 1 })

  // Prune enforces row cap cleanly.
  service.prune(3)
  expect(db.query('SELECT COUNT(*) AS n FROM notification_deliveries').get()).toEqual({ n: 3 })

  // Failed work_done releases turn suppression only for failed devices so the turn's reply still notifies them.
  devices.touch(D2, 'Phone 2', clock)
  service.register(D2, 'test', 'tok-async-5678', 'com.lilbot.app')
  clock += 60_000
  sender.clear()
  let failD2 = true
  sender.setHandler(recipient => (failD2 && recipient.deviceId === D2 ? { status: 'failed', reason: 'sender_error' } : { status: 'sent' }))
  service.noteTurnStarted('b1', 'chat-rollback')
  const wf = await service.notifyWorkFinished(workFixture({ id: 'w-rollback', chatId: 'chat-rollback', origin: { kind: 'conversation', id: 'chat-rollback' } }), 9)
  expect(wf).toEqual({ sent: 1, suppressed: 0, deduped: 0, failed: 1 })
  failD2 = false
  sender.clear()
  const replyAfterFail = await service.notifyReply({ botId: 'b1', chatId: 'chat-rollback', text: 'Done!', dedupeKey: 'r-rollback' })
  expect(replyAfterFail).toEqual({ sent: 1, suppressed: 1, deduped: 0, failed: 0 })
  expect(sender.sent.map(item => item.recipient.deviceId)).toEqual([D2])
})

test('startup and hot-path hooks catch sync/async errors, restrict to main session, dedupe dual-path no-rowId failures, and ignore hidden/stopped turns', async () => {
  const fake = fakeService()
  const devices = new DeviceStore(fake.database)
  devices.touch(D1, 'Phone', 1000)
  const sender = new TestNotificationSender(['test'])
  let mainChat = 'chat-main'
  const notif = createNotifications({
    database: fake.database,
    devices: { exists: (id: string) => Boolean(devices.get(id)) } as never,
    store: fake.store,
    dataDir: fake.root,
    isMainChat: (_botId, chatId) => chatId === mainChat,
    publish: () => {},
    sender
  })
  notif.notifications.register(D1, 'test', 'tok-hooks-1234', 'com.lilbot.app')
  const hooks = notif.conversationHooks({}, (_botId, chatId) => chatId === 'chat-hidden')

  // Kills M10 (hidden session reply) and P1D (stale older non-main session reply).
  mainChat = 'chat-hidden'
  hooks.onTurnFinished?.('b1', 'chat-hidden', { type: 'turn.finished', status: 'completed', text: 'hidden reply', rowId: 'h1' })
  mainChat = 'chat-new'
  hooks.onTurnFinished?.('b1', 'chat-old', { type: 'turn.finished', status: 'completed', text: 'stale reply', rowId: 'old1' })
  // Kills M11 (manual stop with status: 'stopped').
  hooks.onTurnFinished?.('b1', 'chat-new', { type: 'turn.finished', status: 'stopped', text: 'partial text', rowId: 'stop1' })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sender.sent).toHaveLength(0)

  // P1E: missing rowId across openChat (UUID history_events row) and watchActivity (epoch1:42 row) notifies exactly once.
  const history = new HistoryStore(fake.database)
  const failedTurn = { type: 'turn.finished' as const, status: 'failed' as const, text: '' }
  history.event('b1', 'chat-new', { type: 'turn.started' })
  hooks.onTurnStarted?.('b1', 'chat-new')
  history.event('b1', 'chat-new', failedTurn)
  hooks.onTurnFinished?.('b1', 'chat-new', failedTurn, undefined)
  history.event('b1', 'chat-new', failedTurn, 'epoch1:42')
  hooks.onTurnFinished?.('b1', 'chat-new', failedTurn, 'epoch1:42')
  await until(() => sender.sent.length === 1)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sender.sent).toHaveLength(1)

  // P5A: throwing hiddenChat or dropped notification_deliveries table never crashes startup or escapes hooks.
  const brokenHooks = notif.conversationHooks({}, () => {
    throw new Error('lineage read failed')
  })
  expect(() => brokenHooks.onTurnStarted?.('b1', 'chat-new')).not.toThrow()
  expect(() => brokenHooks.onTurnFinished?.('b1', 'chat-new', { type: 'turn.finished', status: 'completed', text: 'hi' })).not.toThrow()

  fake.database.exec('DROP TABLE notification_deliveries;')
  expect(() =>
    createNotifications({
      database: fake.database,
      devices: { exists: () => true } as never,
      store: fake.store,
      dataDir: fake.root,
      isMainChat: () => true,
      publish: () => {},
      sender
    })
  ).not.toThrow()
  expect(() => notif.forgetBot('b1')).not.toThrow()
})
