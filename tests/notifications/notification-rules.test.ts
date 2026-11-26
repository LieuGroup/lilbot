import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { DeviceStore } from '../../server/devices/device-store'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import { NotificationService } from '../../server/notifications/notification-service'
import { NotificationStore } from '../../server/notifications/notification-store'
import type { WorkSummary } from '../../shared/work-schema'

const PHONE = '11111111-1111-4111-8111-111111111111'
const PHONE2 = '22222222-2222-4222-8222-222222222222'
const DESKTOP = '33333333-3333-4333-8333-333333333333'

function makeWork(overrides: Partial<WorkSummary & { chatId?: string | null }> = {}): WorkSummary & { chatId?: string | null } {
  return {
    id: 'w1',
    title: 'Rebuild index',
    ownerId: 'b1',
    ownerName: 'Chief of Staff',
    askedBy: { kind: 'oscar', id: null, name: 'the owner' },
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
    createdAt: 1_000,
    updatedAt: 181_000,
    startedAt: 1_000,
    finishedAt: 181_000,
    ...overrides
  }
}

function setup() {
  let now = 1_700_000_000_000
  const db = openDatabase(':memory:')
  const devices = new DeviceStore(db)
  const sender = new TestNotificationSender(['test'])
  const store = new NotificationStore(db)
  const service = new NotificationService(store, sender, {
    deviceExists: id => Boolean(devices.get(id)),
    botName: id => (id === 'b1' ? 'Chief of Staff' : 'Researcher'),
    now: () => now
  })
  for (const [id, name] of [
    [PHONE, 'iPhone'],
    [PHONE2, 'iPhone 2'],
    [DESKTOP, 'Mac']
  ]) {
    devices.touch(id, name, now)
  }
  service.register(PHONE, 'test', 'phone-token-1')
  return { db, store, sender, service, tick: (ms: number) => (now += ms), now: () => now }
}

test('long work finished suppresses the separate reply alert for that same turn by rule, regardless of timing', async () => {
  const f = setup()
  f.service.register(PHONE2, 'test', 'phone-token-2')
  // PHONE2 disables workDone while keeping replies enabled: per-device rule ensures PHONE2 still gets the reply.
  f.service.setDevicePrefs(PHONE2, { workDone: false })

  f.service.noteTurnStarted('b1', 'chat-1')
  await f.service.notifyWorkFinished(makeWork({ id: 'w-long', startedAt: 0, finishedAt: 150_000 }), 1)
  expect(f.sender.sent.map(x => [x.recipient.deviceId, x.payload.kind])).toEqual([[PHONE, 'work_done']])

  // Even 90 seconds later in the same turn, PHONE does not get a second reply alert; PHONE2 does.
  f.tick(90_000)
  f.sender.clear()
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'All done!', dedupeKey: 'turn-1-reply' })
  expect(f.sender.sent.map(x => [x.recipient.deviceId, x.payload.kind])).toEqual([[PHONE2, 'reply']])

  // Next turn notifies normally on both phones.
  f.sender.clear()
  f.tick(60_000)
  f.service.noteTurnStarted('b1', 'chat-1')
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Next turn reply', dedupeKey: 'turn-2-reply' })
  expect(f.sender.sent.map(x => x.recipient.deviceId).sort()).toEqual([PHONE, PHONE2])
})

test('short work and child work items do not fire work_done; async level-2 checked work notifies without suppressing future turns', async () => {
  const f = setup()
  f.service.noteTurnStarted('b1', 'chat-1')
  await f.service.notifyWorkFinished(makeWork({ id: 'w-short', startedAt: 0, finishedAt: 30_000, checkLevel: 1 }), 1)
  await f.service.notifyWorkFinished(makeWork({ id: 'w-child', parentId: 'w-parent', startedAt: 0, finishedAt: 300_000 }), 2)
  expect(f.sender.sent).toHaveLength(0)

  // Since no work_done fired, the turn's reply notifies normally.
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Quick result', dedupeKey: 'short-reply' })
  expect(f.sender.sent.map(x => x.payload.kind)).toEqual(['reply'])

  // Later, after the turn ended, a level-2 check settles a quick item -> work_done fires and does NOT suppress the next turn.
  f.sender.clear()
  f.tick(60_000)
  await f.service.notifyWorkFinished(makeWork({ id: 'w-checked', startedAt: 0, finishedAt: 10_000, checkLevel: 2 }), 3)
  expect(f.sender.sent.map(x => x.payload.kind)).toEqual(['work_done'])

  f.sender.clear()
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Later reply', dedupeKey: 'later-reply' })
  expect(f.sender.sent.map(x => x.payload.kind)).toEqual(['reply'])
})

test('same phone viewing the bot in foreground suppresses replies, but another device or background state never silences it', async () => {
  const f = setup()
  // Desktop is actively viewing b1 in foreground -> PHONE still gets notified.
  f.service.viewBot('conn-desktop', 'b1', DESKTOP)
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Desktop open', dedupeKey: 'r-desktop' })
  expect(f.sender.sent).toHaveLength(1)

  // PHONE opens b1 in foreground -> suppressed on PHONE.
  f.sender.clear()
  f.tick(60_000)
  f.service.setPresence('conn-phone', PHONE, true, 'b1')
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'While viewing', dedupeKey: 'r-viewing' })
  expect(f.sender.sent).toHaveLength(0)

  // PHONE switches to b2 while b1 remains cached open -> b1 notifies, b2 is suppressed.
  f.service.viewBot('conn-phone', 'b1', PHONE)
  f.service.setPresence('conn-phone', PHONE, true, 'b2')
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Switched away', dedupeKey: 'r-away' })
  await f.service.notifyReply({ botId: 'b2', chatId: 'chat-2', text: 'Viewing b2', dedupeKey: 'r-b2' })
  expect(f.sender.sent.map(x => x.payload.target)).toEqual([{ kind: 'bot', botId: 'b1' }])

  // PHONE goes to background while still remembering botId='b2' (kills M5) -> b2 notifies immediately.
  f.sender.clear()
  f.service.setPresence('conn-phone', PHONE, false, 'b2')
  await f.service.notifyReply({ botId: 'b2', chatId: 'chat-2', text: 'Backgrounded', dedupeKey: 'r-bg' })
  expect(f.sender.sent).toHaveLength(1)

  // Foreground presence on PHONE also suppresses needs_answer for that bot, while PHONE2 still receives it.
  f.sender.clear()
  f.service.register(PHONE2, 'test', 'phone-token-2')
  f.service.setPresence('conn-phone', PHONE, true, 'b1')
  await f.service.notifyWorkNeedsAnswer(makeWork({ id: 'w-fg', status: 'needs_oscar', question: 'Confirm?' }), 7)
  expect(f.sender.sent.map(x => x.recipient.deviceId)).toEqual([PHONE2])

  // Presence expires automatically after TTL if the app dies without closing the socket.
  f.sender.clear()
  f.tick(125_000)
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'After silent app death', dedupeKey: 'r-ttl' })
  expect(f.sender.sent.map(x => x.recipient.deviceId).sort()).toEqual([PHONE, PHONE2])
})

test('reply cooldown groups rapid replies, resets on read/open, urgent alerts bypass it, and dedupe survives restarts', async () => {
  const f = setup()
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'One', dedupeKey: 'r-1' })
  f.tick(5_000)
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Two', dedupeKey: 'r-2' })
  expect(f.sender.sent).toHaveLength(1)

  // Urgent needs_answer bypasses the reply cooldown.
  await f.service.notifyWorkNeedsAnswer(makeWork({ id: 'w-q', status: 'needs_oscar', question: 'Approve?' }), 5)
  expect(f.sender.sent.map(x => x.payload.kind)).toEqual(['reply', 'needs_answer'])

  // Marking b1 read clears the cooldown immediately.
  f.service.markRead('b1', PHONE)
  await f.service.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Three', dedupeKey: 'r-3' })
  expect(f.sender.sent).toHaveLength(3)

  // Durable dedupe and reply cooldown both survive a server restart on the same SQLite DB.
  const sender2 = new TestNotificationSender(['test'])
  const restarted = new NotificationService(new NotificationStore(f.db), sender2, {
    deviceExists: () => true,
    botName: () => 'Chief of Staff',
    now: () => f.now() + 5_000
  })
  expect(await restarted.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'One', dedupeKey: 'r-1' })).toEqual({ sent: 0, suppressed: 1, deduped: 0, failed: 0 })
  expect(await restarted.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'Too soon after restart', dedupeKey: 'r-4' })).toEqual({
    sent: 0,
    suppressed: 1,
    deduped: 0,
    failed: 0
  })

  const afterCooldown = new NotificationService(new NotificationStore(f.db), sender2, {
    deviceExists: () => true,
    botName: () => 'Chief of Staff',
    now: () => f.now() + 60_000
  })
  expect(await afterCooldown.notifyReply({ botId: 'b1', chatId: 'chat-1', text: 'One', dedupeKey: 'r-1' })).toEqual({ sent: 0, suppressed: 0, deduped: 1, failed: 0 })
  await afterCooldown.notifyDeployFailure({ id: 'dep-9', status: 'rolled-back', startedAt: '2026-11-25T00:00:00Z' })
  expect(await afterCooldown.notifyDeployFailure({ id: 'dep-9', status: 'rolled-back', startedAt: '2026-11-25T00:00:00Z' })).toEqual({
    sent: 0,
    suppressed: 0,
    deduped: 1,
    failed: 0
  })
  expect(sender2.sent).toHaveLength(1)
})
