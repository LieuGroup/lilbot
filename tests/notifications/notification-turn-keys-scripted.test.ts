/** Verifies durable turn keys on non-observing engines (including real ScriptedEngine via createAppServices) across restarts. */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNotifications } from '../../server/app-notifications'
import { createAppServices } from '../../server/app-services'
import { DeviceStore } from '../../server/devices/device-store'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { HistoryStore } from '../../server/history/history-store'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const D1 = '88888888-8888-4888-8888-888888888888'
const failEvent = { type: 'turn.finished' as const, status: 'failed' as const, text: '' }

test('non-observing engine keys no-rowId turns on stored history_events rowid across restarts without shifting or merging', async () => {
  const fake = fakeService()
  const devices = new DeviceStore(fake.database)
  devices.touch(D1, 'Phone', 1000)
  const history = new HistoryStore(fake.database)
  const sender = new TestNotificationSender(['test'])
  const chatId = 'chat-scripted'
  const boot = () => {
    const notif = createNotifications({
      database: fake.database,
      devices: { exists: (id: string) => Boolean(devices.get(id)) } as never,
      store: fake.store,
      dataDir: fake.root,
      isMainChat: (_botId, id) => id === chatId,
      observesActivity: () => false,
      publish: () => {},
      sender
    })
    return { notif, hooks: notif.conversationHooks({}, () => false) }
  }

  let app = boot()
  app.notif.notifications.register(D1, 'test', 'tok-scripted-1234', 'com.lilbot.app')

  // 3 pre-restart no-rowId failures -> restart -> 3 brand-new no-rowId failures all notify (total 6).
  for (let i = 0; i < 3; i++) {
    history.event('b1', chatId, failEvent)
    app.hooks.onTurnFinished?.('b1', chatId, failEvent, undefined)
  }
  await until(() => sender.sent.length === 3)
  app = boot()
  for (let i = 0; i < 3; i++) {
    history.event('b1', chatId, failEvent)
    app.hooks.onTurnFinished?.('b1', chatId, failEvent, undefined)
  }
  await until(() => sender.sent.length === 6)

  // Two tabs / duplicate delivery for a rowId turn sends once, and distinct rowIds with identical text both notify across restart.
  sender.clear()
  const sameText1 = { type: 'turn.finished' as const, status: 'failed' as const, text: '', rowId: 'sc-r1' }
  const sameText2 = { type: 'turn.finished' as const, status: 'failed' as const, text: '', rowId: 'sc-r2' }
  app.hooks.onTurnFinished?.('b1', chatId, sameText1, undefined)
  app.hooks.onTurnFinished?.('b1', chatId, sameText1, undefined)
  await until(() => sender.sent.length === 1)
  app = boot()
  app.hooks.onTurnFinished?.('b1', chatId, sameText1, undefined)
  app.hooks.onTurnFinished?.('b1', chatId, sameText2, undefined)
  await until(() => sender.sent.length === 2)
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(sender.sent).toHaveLength(2)
})

test('real ScriptedEngine (no activity observer) notifies through createAppServices before and after restart', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-notif-scripted-'))
  try {
    const dataDir = join(root, 'data')
    const workspacesDir = join(root, 'workspaces')
    const engine = new ScriptedEngine()
    let failCount = 0
    engine.setTurnHandler(async () => {
      failCount++
      return { text: '', status: 'failed' }
    })
    const sender = new TestNotificationSender(['test'])
    const startApp = () =>
      createAppServices(engine, {
        DATA_DIR: dataDir,
        WORKSPACES_DIR: workspacesDir,
        PORT: 0,
        MEMORY_ADAPTER_VERSION: 'test',
        COMMIT: 'testcommit00',
        HOOK_ORIGIN: undefined,
        ACCESS_HOST: undefined,
        notificationSender: sender,
        publish: () => {},
        botsChanged: () => {}
      })

    const app1 = startApp()
    const bot = await app1.bots.createBot({
      name: 'Scripted Bot',
      function: 'Test bot',
      instructions: 'Respond concisely.',
      model: { provider: 'scripted', model: 'echo' },
      permissionMode: 'full-access'
    })
    app1.devices.current(D1, 'Phone')
    app1.notifications.register(D1, 'test', 'tok-real-scripted-1234', 'com.lilbot.app')
    const chat1 = await app1.bots.openChat(bot.id, undefined, () => {})
    await chat1.send('First failing turn')
    await until(() => sender.sent.length === 1)
    chat1.close()

    // Restart LilBot against the same SQLite database and ScriptedEngine.
    const app2 = startApp()
    const chat2 = await app2.bots.openChat(bot.id, undefined, () => {})
    await chat2.send('Second failing turn')
    await until(() => sender.sent.length === 2)
    chat2.close()
    expect(failCount).toBe(2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
