/** Regression tests for durable turn identity across restarts, identical-text distinct rowIds, and dual-path replays. */
import { expect, test } from 'bun:test'
import { createNotifications } from '../../server/app-notifications'
import { DeviceStore } from '../../server/devices/device-store'
import { HistoryStore } from '../../server/history/history-store'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import { NotificationService } from '../../server/notifications/notification-service'
import { NotificationStore } from '../../server/notifications/notification-store'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const D1 = '66666666-6666-4666-8666-666666666666'

test('durable turn keys survive restarts without swallowing new turns, merging distinct rowIds, or duplicating dual-path replays', async () => {
  const fake = fakeService()
  const devices = new DeviceStore(fake.database)
  devices.touch(D1, 'Phone', 1000)
  const history = new HistoryStore(fake.database)
  const sender = new TestNotificationSender(['test'])
  let mainChat = 'chat-main'
  const boot = () => {
    const notif = createNotifications({
      database: fake.database,
      devices: { exists: (id: string) => Boolean(devices.get(id)) } as never,
      store: fake.store,
      dataDir: fake.root,
      isMainChat: (_botId, chatId) => chatId === mainChat,
      publish: () => {},
      sender
    })
    return { notif, hooks: notif.conversationHooks({}, () => false) }
  }

  let app = boot()
  app.notif.notifications.register(D1, 'test', 'tok-turns-1234', 'com.lilbot.app')
  const failEvent = { type: 'turn.finished' as const, status: 'failed' as const, text: '' }

  // Case 1: 3 pre-restart no-rowId failures -> restart -> 3 brand-new no-rowId failures all notify (total 6).
  for (let i = 0; i < 3; i++) {
    history.event('b1', mainChat, { type: 'turn.started' })
    app.hooks.onTurnStarted?.('b1', mainChat)
    history.event('b1', mainChat, failEvent)
    app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  }
  await until(() => sender.sent.length === 3)

  app = boot() // Simulate server restart on the same SQLite DB.
  for (let i = 0; i < 3; i++) {
    history.event('b1', mainChat, { type: 'turn.started' })
    app.hooks.onTurnStarted?.('b1', mainChat)
    history.event('b1', mainChat, failEvent)
    app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  }
  await until(() => sender.sent.length === 6)

  // Same-text no-rowId reply ("OK") before restart -> restart -> brand-new no-rowId "OK" reply notifies after cooldown.
  sender.clear()
  let clock = 1_700_000_000_000
  const okEvent = { type: 'turn.finished' as const, status: 'completed' as const, text: 'OK' }
  history.event('b1', mainChat, okEvent)
  const svcA = new NotificationService(new NotificationStore(fake.database), sender, {
    deviceExists: () => true,
    botName: () => 'Bot One',
    now: () => clock,
    replyCooldownMs: 0
  })
  const stored1 = fake.database.query("SELECT MAX(rowid) AS id FROM history_events WHERE bot='b1' AND session=?").get(mainChat) as { id: number }
  expect(await svcA.notifyReply({ botId: 'b1', chatId: mainChat, text: 'OK', dedupeKey: `reply:${mainChat}:he:${stored1.id}` })).toMatchObject({ sent: 1 })
  clock += 60_000
  history.event('b1', mainChat, okEvent)
  const stored2 = fake.database.query("SELECT MAX(rowid) AS id FROM history_events WHERE bot='b1' AND session=?").get(mainChat) as { id: number }
  const svcB = new NotificationService(new NotificationStore(fake.database), sender, {
    deviceExists: () => true,
    botName: () => 'Bot One',
    now: () => clock,
    replyCooldownMs: 0
  })
  expect(await svcB.notifyReply({ botId: 'b1', chatId: mainChat, text: 'OK', dedupeKey: `reply:${mainChat}:he:${stored2.id}` })).toMatchObject({ sent: 1 })
  expect(sender.sent).toHaveLength(2)

  // Case 2: Identical-text replies ("Done.") with distinct rowIds and no onTurnStarted between them, plus a restart in the middle.
  sender.clear()
  const svc1 = new NotificationService(new NotificationStore(fake.database), sender, { deviceExists: () => true, botName: () => 'Bot One', replyCooldownMs: 0 })
  expect(await svc1.notifyReply({ botId: 'b1', chatId: mainChat, text: 'Done.', dedupeKey: `reply:${mainChat}:row:r-1` })).toMatchObject({ sent: 1 })
  const svc2 = new NotificationService(new NotificationStore(fake.database), sender, { deviceExists: () => true, botName: () => 'Bot One', replyCooldownMs: 0 })
  expect(await svc2.notifyReply({ botId: 'b1', chatId: mainChat, text: 'Done.', dedupeKey: `reply:${mainChat}:row:r-1` })).toMatchObject({ deduped: 1 })
  expect(await svc2.notifyReply({ botId: 'b1', chatId: mainChat, text: 'Done.', dedupeKey: `reply:${mainChat}:row:r-2` })).toMatchObject({ sent: 1 })
  expect(await svc2.notifyReply({ botId: 'b1', chatId: mainChat, text: 'Done.', dedupeKey: `reply:${mainChat}:row:r-3` })).toMatchObject({ sent: 1 })
  expect(sender.sent).toHaveLength(3)

  // Case 3: Pre-restart openChat no-rowId failure -> restart -> watchActivity replays (with turn.started + turn.finished) -> deduped; new post-restart turn notifies.
  sender.clear()
  mainChat = 'chat-c'
  app = boot()
  const images = { support: 'unknown' as const, imageCount: 0 }
  history.event('b1', mainChat, { type: 'user.message', messageId: 'm-1', text: 'Run task', attachments: [], images })
  history.event('b1', mainChat, { type: 'turn.started' })
  app.hooks.onTurnStarted?.('b1', mainChat)
  history.event('b1', mainChat, failEvent)
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  await until(() => sender.sent.length === 1)

  app = boot() // Server restart before watchActivity polled.
  history.event('b1', mainChat, { type: 'turn.started' }, '0:98')
  app.hooks.onTurnStarted?.('b1', mainChat)
  history.event('b1', mainChat, failEvent, '0:99')
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:99')
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(sender.sent).toHaveLength(1)

  // Brand-new post-restart turn notifies once, and its observer echo is deduped.
  history.event('b1', mainChat, { type: 'user.message', messageId: 'm-2', text: 'Try again', attachments: [], images })
  history.event('b1', mainChat, { type: 'turn.started' })
  app.hooks.onTurnStarted?.('b1', mainChat)
  history.event('b1', mainChat, failEvent)
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  history.event('b1', mainChat, failEvent, '0:101')
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:101')
  await until(() => sender.sent.length === 2)
  await new Promise(resolve => setTimeout(resolve, 25))
  expect(sender.sent).toHaveLength(2)
})
