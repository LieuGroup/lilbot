import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { DeviceStore } from '../../server/devices/device-store'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import { NotificationService } from '../../server/notifications/notification-service'
import { NotificationStore } from '../../server/notifications/notification-store'
import { boundCollapseId } from '../../server/notifications/notification-text'

function fixture(opts: { channels?: ('apns' | 'apns_sandbox' | 'test')[] } = {}) {
  let clock = 1_700_000_000_000
  const db = openDatabase(':memory:')
  const devices = new DeviceStore(db)
  const sender = new TestNotificationSender(opts.channels ?? ['test'])
  const botNames = new Map<string, string>([
    ['b1', 'Chief of Staff'],
    ['b2', 'Researcher']
  ])
  let changes = 0
  const store = new NotificationStore(db)
  const service = new NotificationService(store, sender, {
    deviceExists: id => Boolean(devices.get(id)),
    botName: id => botNames.get(id) ?? 'LilBot',
    botExists: id => botNames.has(id),
    changed: () => changes++,
    now: () => clock
  })
  const addDevice = (id: string, name = 'iPhone') => {
    devices.touch(id, name, clock)
    return id
  }
  return { db, devices, store, sender, service, addDevice, tick: (ms: number) => (clock += ms), getChanges: () => changes }
}

const D1 = '11111111-1111-4111-8111-111111111111'
const D2 = '22222222-2222-4222-8222-222222222222'

test('registration requires an existing device, hides raw tokens, deduplicates reinstall tokens, and disables invalid tokens', async () => {
  const f = fixture()
  expect(() => f.service.register(D1, 'test', 'tok-12345678')).toThrow('This device is not known')
  f.addDevice(D1, 'Phone 1')
  f.addDevice(D2, 'Phone 1 reinstalled')

  const ep1 = f.service.register(D1, 'test', 'shared-token-1234', 'com.lilbot.app')
  expect(ep1).toMatchObject({ deviceId: D1, channel: 'test', bundleId: 'com.lilbot.app', enabled: true, disabledReason: null })
  expect('token' in ep1).toBe(false)

  // Reinstall gives the phone a new deviceId with the same push token: stale deviceId binding is dropped.
  f.service.register(D2, 'test', 'shared-token-1234', 'com.lilbot.app')
  expect(f.service.getSettings(D1).endpoints).toEqual([])
  expect(f.service.getSettings(D2).endpoints).toHaveLength(1)

  // Invalid token response automatically disables the endpoint until re-registered.
  f.sender.setHandler(() => ({ status: 'invalid_token', reason: 'Unregistered' }))
  const failed = await f.service.notifyReply({ botId: 'b1', chatId: 'c1', text: 'hello', dedupeKey: 'r1' })
  expect(failed).toEqual({ sent: 0, suppressed: 0, deduped: 0, failed: 1 })
  expect(f.service.getSettings(D2).endpoints[0]).toMatchObject({ enabled: false, disabledReason: 'Unregistered' })

  f.sender.clear()
  f.sender.setHandler(undefined)
  expect(await f.service.notifyReply({ botId: 'b1', chatId: 'c1', text: 'second', dedupeKey: 'r2' })).toEqual({ sent: 0, suppressed: 0, deduped: 0, failed: 0 })

  // Re-registering refreshes and re-enables the endpoint; unregistering removes it.
  f.service.register(D2, 'test', 'fresh-token-9999', 'com.lilbot.app')
  expect(f.service.getSettings(D2).endpoints[0]).toMatchObject({ enabled: true, disabledReason: null })
  f.service.unregister(D2, 'test')
  expect(f.service.getSettings(D2).endpoints).toEqual([])
})

test('unconfigured channels are skipped cleanly without burning dedupe keys or failing', async () => {
  const f = fixture({ channels: ['test'] })
  f.addDevice(D1)
  f.service.register(D1, 'apns', 'a'.repeat(64), 'com.lilbot.app')
  const res = await f.service.notifyReply({ botId: 'b1', chatId: 'c1', text: 'hello', dedupeKey: 'r-apns' })
  expect(res).toEqual({ sent: 0, suppressed: 0, deduped: 0, failed: 0 })
  expect(f.service.getSettings(D1).endpoints[0].enabled).toBe(true)

  // Mounting a sender for APNs later still delivers that key because it was not burned.
  const apnsSender = new TestNotificationSender(['apns'])
  const later = new NotificationService(f.store, apnsSender, { deviceExists: () => true, botName: () => 'Chief of Staff' })
  expect(await later.notifyReply({ botId: 'b1', chatId: 'c1', text: 'hello', dedupeKey: 'r-apns' })).toMatchObject({ sent: 1 })
})

test('lock-screen copy defaults to generic lines and opt-in previews strip markdown and fall back on secrets', async () => {
  const f = fixture()
  f.addDevice(D1, 'Generic Phone')
  f.addDevice(D2, 'Preview Phone')
  f.service.register(D1, 'test', 'token-device-1')
  f.service.register(D2, 'test', 'token-device-2')
  f.service.setDevicePrefs(D2, { showPreview: true })

  await f.service.notifyReply({ botId: 'b1', chatId: 'c1', text: '**Done** — see [report](https://example.com) /api/attachments/b1/x.png', dedupeKey: 'reply-1' })
  const byDev = new Map(f.sender.sent.map(item => [item.recipient.deviceId, item.payload]))
  expect(byDev.get(D1)).toMatchObject({ title: 'Chief of Staff', body: 'Sent a reply', target: { kind: 'bot', botId: 'b1' }, priority: 'normal' })
  expect(byDev.get(D2)?.body).toBe('Done — see report')

  // Secret-looking reply falls back to generic even when showPreview is enabled.
  f.sender.clear()
  f.tick(60_000)
  await f.service.notifyReply({ botId: 'b1', chatId: 'c1', text: 'Use key sk-live-1234567890abcdefghijklmnop here', dedupeKey: 'reply-secret' })
  expect(f.sender.sent.every(item => item.payload.body === 'Sent a reply')).toBe(true)

  // Turn failure and deploy failure stay generic even with showPreview enabled.
  f.sender.clear()
  await f.service.notifyTurnFailed({ botId: 'b1', chatId: 'c1', reason: 'memory_save', dedupeKey: 'fail-1' })
  await f.service.notifyDeployFailure({ id: 'job-1', status: 'rolled-back', startedAt: '2026-11-25T00:00:00Z' })
  expect(f.sender.sent.filter(x => x.payload.kind === 'turn_failed').every(x => x.payload.body === 'Stopped before saving memory')).toBe(true)
  expect(f.sender.sent.filter(x => x.payload.kind === 'deploy_failed').every(x => x.payload.title === 'LilBot' && x.payload.body === 'A deploy failed and rolled back')).toBe(true)

  // Collapse IDs stay <= 64 ASCII bytes.
  expect(Buffer.byteLength(boundCollapseId(`reply:${'x'.repeat(120)}`), 'utf8')).toBeLessThanOrEqual(64)
})

test('per-device switches, per-bot mute, and forgetBot cleanup behave independently', async () => {
  const f = fixture()
  f.addDevice(D1)
  f.addDevice(D2)
  f.service.register(D1, 'test', 'token-device-1')
  f.service.register(D2, 'test', 'token-device-2')

  f.service.setDevicePrefs(D1, { replies: false })
  await f.service.notifyReply({ botId: 'b1', chatId: 'c1', text: 'hi', dedupeKey: 'r1' })
  expect(f.sender.sent.map(x => x.recipient.deviceId)).toEqual([D2])

  // Master switch off on D2 silences even urgent deploy alerts for D2, while D1 still gets them.
  f.sender.clear()
  f.service.setDevicePrefs(D2, { enabled: false })
  await f.service.notifyDeployFailure({ id: 'job-2', status: 'manual-recovery', startedAt: '2026-11-25T00:00:00Z' })
  expect(f.sender.sent.map(x => x.recipient.deviceId)).toEqual([D1])

  // Muting b1 blocks b1 events everywhere but does not affect b2 or deploy failures.
  f.sender.clear()
  f.service.setDevicePrefs(D1, { replies: true })
  f.service.setDevicePrefs(D2, { enabled: true })
  f.service.setBotPrefs('b1', true)
  expect(f.service.getSettings(D1).mutedBotIds).toEqual(['b1'])
  await f.service.notifyTurnFailed({ botId: 'b1', chatId: 'c1', dedupeKey: 'f-b1' })
  expect(f.sender.sent).toHaveLength(0)
  await f.service.notifyTurnFailed({ botId: 'b2', chatId: 'c2', dedupeKey: 'f-b2' })
  expect(f.sender.sent).toHaveLength(2)

  // Deleting a bot removes its mute row and delivery history.
  f.service.forgetBot('b1')
  expect(f.service.getSettings(D1).mutedBotIds).toEqual([])
})

test('migration 43 upgrades a schema-42 database cleanly while preserving devices', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-mig43-'))
  try {
    const path = join(dir, 'lilbot.db')
    let db = openDatabase(path)
    new DeviceStore(db).touch(D1, 'iPhone', 1000)
    db.exec(
      'DROP TABLE notification_deliveries; DROP TABLE notification_bot_prefs; DROP TABLE notification_device_prefs; DROP TABLE notification_endpoints; PRAGMA user_version = 42;'
    )
    db.close()
    db = openDatabase(path)
    expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: 43 })
    expect(new DeviceStore(db).get(D1)?.name).toBe('iPhone')
    const store = new NotificationStore(db)
    expect(store.register(D1, 'test', 'migrated-tok-1234', 'com.lilbot.app', 2000).enabled).toBe(true)
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
