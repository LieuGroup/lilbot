import { expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAppServices } from '../../server/app-services'
import { BrowserSession } from '../../server/http/browser-session'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import type { EventFrame, ResponseFrame } from '../../shared/protocol'
import { fakeEngine } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const DEVICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

async function call(session: BrowserSession, frames: (ResponseFrame | EventFrame)[], id: number, method: string, params: Record<string, unknown> = {}) {
  await session.handle(JSON.stringify({ id, method, params }))
  const reply = frames.find((f): f is ResponseFrame => 'id' in f && f.id === id)
  if (!reply?.ok) throw new Error(`RPC ${method} failed: ${JSON.stringify(reply)}`)
  return reply.result
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), 'lilbot-notif-test-'))
}

test('BrowserSession notification RPCs, conversation replies/failures, and bot cleanup work end-to-end', async () => {
  const root = makeTempDir()
  try {
    const dataDir = join(root, 'data')
    const workspacesDir = join(root, 'workspaces')
    mkdirSync(dataDir, { recursive: true })
    mkdirSync(workspacesDir, { recursive: true })

    const fake = fakeEngine()
    const sender = new TestNotificationSender(['test'])
    const events: EventFrame[] = []
    const services = createAppServices(fake.engine, {
      DATA_DIR: dataDir,
      WORKSPACES_DIR: workspacesDir,
      PORT: 0,
      MEMORY_ADAPTER_VERSION: 'test',
      COMMIT: 'testcommit00',
      HOOK_ORIGIN: undefined,
      ACCESS_HOST: undefined,
      notificationSender: sender,
      publish: frame => events.push(frame),
      botsChanged: () => {}
    })

    const frames: (ResponseFrame | EventFrame)[] = []
    const session = new BrowserSession(
      services.bots,
      frame => frames.push(frame),
      services.activity,
      services.routines,
      services.library,
      services.threads,
      undefined,
      services.computers,
      undefined,
      services.attachments,
      undefined,
      services.devices,
      services.boards.work,
      services.webhooks,
      services.boards.goals,
      services.notifications
    )

    const bots = await services.bots.listBots()
    const botId = bots[0].id
    await call(session, frames, 1, 'devices.current', { deviceId: DEVICE, name: 'Test iPhone' })
    const reg = await call(session, frames, 2, 'notifications.register', { deviceId: DEVICE, channel: 'test', token: 'tok-e2e-1234', bundleId: 'com.lilbot.app' })
    expect(reg).toMatchObject({ deviceId: DEVICE, channel: 'test', enabled: true })

    const settings = await call(session, frames, 3, 'notifications.prefs.get', { deviceId: DEVICE })
    expect(settings).toMatchObject({ device: { enabled: true, showPreview: false, replies: true }, mutedBotIds: [] })
    expect(events.some(e => e.event === 'notifications.changed')).toBe(true)

    await call(session, frames, 4, 'notifications.prefs.set', { deviceId: DEVICE, showPreview: true })
    await call(session, frames, 5, 'notifications.presence', { deviceId: DEVICE, foreground: false, botId: null })

    // Open chat while backgrounded -> main-conversation reply and turn failure both notify.
    const snap = (await call(session, frames, 6, 'chat.open', { botId })) as { chatId: string }
    await call(session, frames, 7, 'chat.send', { chatId: snap.chatId, text: 'hello', deviceId: DEVICE })
    fake.emit(snap.chatId, { type: 'turn.finished', status: 'completed', text: 'Here is the **result**', rowId: 'row-1' })
    await until(() => sender.sent.some(item => item.payload.kind === 'reply'))
    expect(sender.sent.find(item => item.payload.kind === 'reply')?.payload).toMatchObject({
      title: 'Bot One',
      body: 'Here is the result',
      target: { kind: 'bot', botId }
    })

    // Same rowId replayed never re-notifies.
    const beforeCount = sender.sent.length
    fake.emit(snap.chatId, { type: 'turn.finished', status: 'completed', text: 'Here is the **result**', rowId: 'row-1' })
    await new Promise(resolve => setTimeout(resolve, 15))
    expect(sender.sent).toHaveLength(beforeCount)

    // Turn failure notifies urgently even within reply cooldown.
    fake.emit(snap.chatId, { type: 'turn.finished', status: 'failed', text: '', rowId: 'row-2', failure: 'memory_save' })
    await until(() => sender.sent.some(item => item.payload.kind === 'turn_failed'))
    expect(sender.sent.find(item => item.payload.kind === 'turn_failed')?.payload).toMatchObject({
      title: 'Bot One',
      body: 'Stopped before saving memory',
      priority: 'urgent'
    })

    // Bot mute RPC works and persists; unregister removes endpoint.
    await call(session, frames, 8, 'notifications.botPrefs.set', { botId, muted: true })
    expect(await call(session, frames, 9, 'notifications.prefs.get', { deviceId: DEVICE })).toMatchObject({ mutedBotIds: [botId] })
    await call(session, frames, 10, 'notifications.unregister', { deviceId: DEVICE, channel: 'test' })
    expect(await call(session, frames, 11, 'notifications.prefs.get', { deviceId: DEVICE })).toMatchObject({ endpoints: [] })

    session.close()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('startup deploy notice notifies registered devices once across restarts', async () => {
  const root = makeTempDir()
  try {
    const dataDir = join(root, 'data')
    const workspacesDir = join(root, 'workspaces')
    mkdirSync(join(dataDir, 'deploy'), { recursive: true })
    mkdirSync(workspacesDir, { recursive: true })

    // First boot: register a device and push token.
    const first = createAppServices(fakeEngine().engine, {
      DATA_DIR: dataDir,
      WORKSPACES_DIR: workspacesDir,
      PORT: 0,
      MEMORY_ADAPTER_VERSION: 'test',
      COMMIT: 'testcommit00',
      HOOK_ORIGIN: undefined,
      ACCESS_HOST: undefined,
      notificationSender: new TestNotificationSender(['test']),
      publish: () => {},
      botsChanged: () => {}
    })
    first.devices.current(DEVICE, 'iPhone')
    first.notifications.register(DEVICE, 'test', 'tok-deploy-1234', 'com.lilbot.app')

    // Write a rolled-back deploy notice and restart services twice -> notifies exactly once.
    writeFileSync(
      join(dataDir, 'deploy', 'notice.json'),
      JSON.stringify({ id: 'dep-42', status: 'rolled-back', commit: 'abcdef123456', previous: '111111222222', startedAt: '2026-11-25T00:00:00Z' })
    )
    const sender2 = new TestNotificationSender(['test'])
    createAppServices(fakeEngine().engine, {
      DATA_DIR: dataDir,
      WORKSPACES_DIR: workspacesDir,
      PORT: 0,
      MEMORY_ADAPTER_VERSION: 'test',
      COMMIT: '111111222222',
      HOOK_ORIGIN: undefined,
      ACCESS_HOST: undefined,
      notificationSender: sender2,
      publish: () => {},
      botsChanged: () => {}
    })
    await until(() => sender2.sent.length === 1)
    expect(sender2.sent[0].payload).toMatchObject({ kind: 'deploy_failed', title: 'LilBot', target: { kind: 'deploy' } })

    const sender3 = new TestNotificationSender(['test'])
    createAppServices(fakeEngine().engine, {
      DATA_DIR: dataDir,
      WORKSPACES_DIR: workspacesDir,
      PORT: 0,
      MEMORY_ADAPTER_VERSION: 'test',
      COMMIT: '111111222222',
      HOOK_ORIGIN: undefined,
      ACCESS_HOST: undefined,
      notificationSender: sender3,
      publish: () => {},
      botsChanged: () => {}
    })
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(sender3.sent).toHaveLength(0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
