import { expect, test } from 'bun:test'
import { createGoals } from '../../server/app-goals'
import { createNotifications } from '../../server/app-notifications'
import { createWork } from '../../server/app-work'
import { Workspaces } from '../../server/bots/workspaces'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { createDevices } from '../../server/devices/device-service'
import { GoalStore } from '../../server/goals/goal-store'
import { HistoryStore } from '../../server/history/history-store'
import { LibraryStore } from '../../server/library/library-store'
import { TestNotificationSender } from '../../server/notifications/notification-sender'
import { RoutineService, routineSettings } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { CallingChats } from '../../server/threads/calling-chats'
import { ThreadStore } from '../../server/threads/thread-store'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import type { WorkInput } from '../../shared/work-schema'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const DEVICE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

test('WorkService and GoalService trigger needs_answer and work_done notifications end-to-end', async () => {
  const fake = fakeService()
  const sender = new TestNotificationSender(['test'])
  const computers = new ComputerService(
    new ComputerStore(fake.database),
    loadServerKey(fake.root),
    id => fake.store.exists(id),
    id => `${fake.root}/${id}`,
    () => {}
  )
  const devices = createDevices(fake.database, computers, () => {})
  const notif = createNotifications({
    database: fake.database,
    devices,
    store: fake.store,
    dataDir: fake.root,
    isMainChat: (_botId, chatId) => chatId === 'b1-main',
    publish: () => {},
    sender
  })
  devices.current(DEVICE, 'iPhone')
  notif.notifications.register(DEVICE, 'test', 'tok-wiring-1234', 'com.lilbot.app')

  const calls = new CallingChats(0)
  const routineStore = new RoutineStore(fake.database)
  const goalStore = new GoalStore(fake.database)
  const work = createWork({
    ...fake,
    bots: fake.service,
    threadStore: new ThreadStore(fake.database),
    routineStore,
    webhookStore: new WebhookStore(fake.database),
    rootOf: (_bot, chat) => chat,
    goalStore,
    libraryStore: new LibraryStore(fake.database),
    workspaces: new Workspaces(fake.root),
    history: new HistoryStore(fake.database),
    calls,
    reviewModel: null,
    onStatus: notif.onWorkStatus,
    publish: () => {}
  })
  const routines = new RoutineService(routineStore, fake.service, () => {}, routineSettings({}))
  const { goals } = createGoals({
    goalStore,
    work: work.work,
    answers: work.answers,
    threads: { oscarAnswer: () => {}, dropped: () => async () => {} },
    routines,
    activity: fake.activity,
    store: fake.store,
    publish: () => {},
    onWaiting: notif.onGoalWaiting,
    repeat: () => {}
  })

  const act = (input: WorkInput, chat = 'b1-main') => {
    calls.saw('b1', chat, 'mcp__lilbot_system__lilbot_work', input, crypto.randomUUID())
    return work.work.act('b1', input)
  }

  // 1. Work item enters needs_oscar -> urgent needs_answer notification with work target.
  const item = await act({ requestId: 'w-1', title: 'Ship release', kind: 'code', done: 'tests pass' })
  await act({ requestId: 'w-2', itemId: item.id, status: 'needs_oscar', question: 'Ready to tag?' })
  await until(() => sender.sent.some(s => s.payload.target.kind === 'work' && s.payload.kind === 'needs_answer'))
  expect(sender.sent.at(-1)?.payload).toMatchObject({
    kind: 'needs_answer',
    title: 'Bot One',
    body: 'Needs your answer',
    priority: 'urgent',
    target: { kind: 'work', workItemId: item.id, botId: 'b1' }
  })

  // 2. Goal proposal enters waitsForOscar -> urgent needs_answer notification with goal target.
  const goalInput = {
    action: 'propose' as const,
    requestId: 'g-1',
    text: 'Keep latency under 100ms',
    agreement: { alone: ['Measure p95'], needsOscar: ['Approve infra spend'], cannotInfluence: ['ISP'] },
    target: {
      measure: 'p95 ms',
      source: 'metrics',
      baseline: 140,
      evidence: { proves: 'baseline p95', value: '140', source: 'metrics' },
      value: 100,
      due: '2026-12-31'
    }
  }
  calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_goal', goalInput, crypto.randomUUID())
  const proposed = await goals.act('b1', goalInput)
  await until(() => sender.sent.some(s => s.payload.target.kind === 'goal'))
  expect(sender.sent.find(s => s.payload.target.kind === 'goal')?.payload).toMatchObject({
    kind: 'needs_answer',
    title: 'Bot One',
    body: 'Needs your agreement on a goal',
    priority: 'urgent',
    target: { kind: 'goal', goalId: proposed.id, botId: 'b1' }
  })

  // 3. Top-level failed work item triggers work_done and suppresses duplicate reply in the same turn.
  sender.clear()
  notif.notifications.noteTurnStarted('b1', 'b1-main')
  await act({ requestId: 'w-3', itemId: item.id, status: 'failed', result: 'Build failed on lint' })
  await until(() => sender.sent.some(s => s.payload.kind === 'work_done'))
  expect(sender.sent[0].payload).toMatchObject({ kind: 'work_done', body: 'A task failed', target: { kind: 'work', workItemId: item.id, botId: 'b1' } })

  const replySummary = await notif.notifications.notifyReply({ botId: 'b1', chatId: 'b1-main', text: 'I marked it failed.', dedupeKey: 'after-fail' })
  expect(replySummary).toMatchObject({ sent: 0, suppressed: 1 })
})
