/** Regression tests for single-path durable turn identity on observing engines across restarts (all 8 cases). */
import { expect, test } from 'bun:test'
import { createNotifications } from '../../server/app-notifications'
import { DeviceStore } from '../../server/devices/device-store'
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { HistoryStore } from '../../server/history/history-store'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import { NotificationService } from '../../server/notifications/notification-service'
import { NotificationStore } from '../../server/notifications/notification-store'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const D1 = '66666666-6666-4666-8666-666666666666'
const failEvent = { type: 'turn.finished' as const, status: 'failed' as const, text: '' }
const images = { support: 'unknown' as const, imageCount: 0 }

test('EngineRegistry.observesActivity reflects the neutral watchActivity capability without engine-name checks', () => {
  const scripted = new ScriptedEngine()
  const observing = { ...scripted, id: 'custom-observer', watchActivity: () => () => {} } as unknown as BotEngine
  const registry = new EngineRegistry([scripted, observing], 'scripted')
  expect(registry.observesActivity('scripted')).toBe(false)
  expect(registry.observesActivity('custom-observer')).toBe(true)
  expect(registry.observesActivity('missing-engine')).toBe(false)
})

test('observing engine: restarts never swallow new turns, merge distinct rowIds, or double-send dual-path replays', async () => {
  const fake = fakeService()
  const devices = new DeviceStore(fake.database)
  devices.touch(D1, 'Phone', 1000)
  const history = new HistoryStore(fake.database)
  const sender = new TestNotificationSender(['test'])
  let mainChat = 'chat-obs-1'
  const boot = () => {
    const notif = createNotifications({
      database: fake.database,
      devices: { exists: (id: string) => Boolean(devices.get(id)) } as never,
      store: fake.store,
      dataDir: fake.root,
      isMainChat: (_botId, chatId) => chatId === mainChat,
      observesActivity: () => true,
      publish: () => {},
      sender
    })
    return { notif, hooks: notif.conversationHooks({}, () => false) }
  }

  let app = boot()
  app.notif.notifications.register(D1, 'test', 'tok-obs-1234', 'com.lilbot.app')

  // 1. 3 pre-restart no-rowId failures -> restart -> 3 brand-new failures notify (total 6); replaying old keys dedupes.
  for (let i = 1; i <= 3; i++) {
    app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
    app.hooks.onTurnFinished?.('b1', mainChat, failEvent, `0:${i}`)
  }
  await until(() => sender.sent.length === 3)
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:1')
  for (let i = 4; i <= 6; i++) app.hooks.onTurnFinished?.('b1', mainChat, failEvent, `0:${i}`)
  await until(() => sender.sent.length === 6)

  // 2. Identical text ("Done.") with distinct rowIds and no onTurnStarted across restart: both notify, replay dedupes.
  sender.clear()
  const svc1 = new NotificationService(new NotificationStore(fake.database), sender, { deviceExists: () => true, botName: () => 'Bot One', replyCooldownMs: 0 })
  expect(await svc1.notifyReply({ botId: 'b1', chatId: mainChat, text: 'Done.', dedupeKey: `reply:${mainChat}:row:r-1` })).toMatchObject({ sent: 1 })
  const svc2 = new NotificationService(new NotificationStore(fake.database), sender, { deviceExists: () => true, botName: () => 'Bot One', replyCooldownMs: 0 })
  expect(await svc2.notifyReply({ botId: 'b1', chatId: mainChat, text: 'Done.', dedupeKey: `reply:${mainChat}:row:r-1` })).toMatchObject({ deduped: 1 })
  expect(await svc2.notifyReply({ botId: 'b1', chatId: mainChat, text: 'Done.', dedupeKey: `reply:${mainChat}:row:r-2` })).toMatchObject({ sent: 1 })
  expect(sender.sent).toHaveLength(2)

  // 3. Pre-restart openChat no-rowId failure -> restart -> observer delivers once (0:99) -> replay dedupes -> new turn notifies.
  sender.clear()
  mainChat = 'chat-obs-3'
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sender.sent).toHaveLength(0)
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:99')
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:99')
  await until(() => sender.sent.length === 1)
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:101')
  await until(() => sender.sent.length === 2)
  expect(history.db.query('SELECT COUNT(*) AS n FROM notification_deliveries').get()).toBeTruthy()
})

test('observing engine: missed observer event, observer-first, two tabs, late live echo, and replay-epoch change across restarts', async () => {
  const fake = fakeService()
  const devices = new DeviceStore(fake.database)
  devices.touch(D1, 'Phone', 1000)
  const history = new HistoryStore(fake.database)
  const sender = new TestNotificationSender(['test'])
  let mainChat = 'chat-missed'
  const boot = () => {
    const notif = createNotifications({
      database: fake.database,
      devices: { exists: (id: string) => Boolean(devices.get(id)) } as never,
      store: fake.store,
      dataDir: fake.root,
      isMainChat: (_botId, chatId) => chatId === mainChat,
      observesActivity: () => true,
      publish: () => {},
      sender
    })
    return { notif, hooks: notif.conversationHooks({}, () => false) }
  }

  let app = boot()
  app.notif.notifications.register(D1, 'test', 'tok-edge-1234', 'com.lilbot.app')

  // 2A. Missed observer event on Turn 1 -> Turn 2 observer-only (app closed) notifies -> restart -> Turns 3..5 notify with zero shift.
  history.event('b1', mainChat, failEvent)
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  history.event('b1', mainChat, { type: 'user.message', messageId: 'u2', text: 'Second', attachments: [], images })
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:20')
  await until(() => sender.sent.length === 1)
  app = boot()
  for (const seq of [30, 40, 50]) app.hooks.onTurnFinished?.('b1', mainChat, failEvent, `0:${seq}`)
  await until(() => sender.sent.length === 4)

  // Observer-first then live-second across Turns 1..3 with restart in middle -> 1 per turn, zero shift.
  sender.clear()
  mainChat = 'chat-obs-first'
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:1')
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  await until(() => sender.sent.length === 1)
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:2')
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:3')
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  await until(() => sender.sent.length === 3)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sender.sent).toHaveLength(3)

  // 2B. Two open tabs receiving Turn 1 -> observer Turn 1 -> 1 notification -> restart -> Turn 2 notifies (never dropped).
  sender.clear()
  mainChat = 'chat-two-tabs'
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:10')
  await until(() => sender.sent.length === 1)
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:20')
  await until(() => sender.sent.length === 2)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sender.sent).toHaveLength(2)

  // 2C. Observer Turn 1 -> new user.message -> late live echo of Turn 1 ignored -> restart -> Turn 2 notifies.
  sender.clear()
  mainChat = 'chat-late-live'
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:10')
  await until(() => sender.sent.length === 1)
  history.event('b1', mainChat, { type: 'user.message', messageId: 'u-next', text: 'Next', attachments: [], images })
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, undefined)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sender.sent).toHaveLength(1)
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:20')
  await until(() => sender.sent.length === 2)

  // 2D. Replay-epoch change: rowId dedupes across epochs & restart; no-rowId epoch reset never shifts later turns.
  sender.clear()
  mainChat = 'chat-epoch'
  app = boot()
  const rowFail = { type: 'turn.finished' as const, status: 'failed' as const, text: '', rowId: 'hermes:b1:500' }
  app.hooks.onTurnFinished?.('b1', mainChat, rowFail, '0:10')
  await until(() => sender.sent.length === 1)
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, rowFail, '1:10')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sender.sent).toHaveLength(1)
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '0:11')
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '1:11')
  app = boot()
  app.hooks.onTurnFinished?.('b1', mainChat, failEvent, '1:12')
  await until(() => sender.sent.length === 4)
})
