/** Unregistered-engine bots must fail fast with zero readiness timers, never spin routines/webhooks, never stick working, and never consume concurrency. */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { RoutineScheduler } from '../../server/routines/routine-scheduler'
import { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { WebhookService } from '../../server/webhooks/webhook-service'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import type { ActivityEvent } from '../../shared/activity-schema'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-unreg-'))
  dirs.push(root)
  const db = openDatabase(join(root, 'lilbot.db'))
  const store = new BotStore(db)
  const prefs = new BotPrefsStore(db)
  const workspaces = new Workspaces(join(root, 'workspaces'))
  const engine = new ScriptedEngine({ id: 'scripted-a' })
  const registry = new EngineRegistry([engine])
  const activity = new ActivityService(new ActivityStore(db), () => {})
  const memory = {
    list: () => [],
    forgetPrivate: () => {},
    contextBlock: () => '',
    write: () => {
      throw new Error('unused')
    }
  } as any
  const bots = new BotService(registry, store, prefs, workspaces, memory)
  const observed: ActivityEvent[] = []
  const observe = (event: ActivityEvent) => {
    observed.push(event)
    activity.observe(event)
  }
  const addGhost = (id: string) =>
    store.save({
      id,
      name: `Ghost ${id}`,
      function: 'Missing engine',
      instructions: '',
      model: null,
      reasoningEffort: null,
      isDefault: false,
      permissionMode: 'full-access',
      engineId: 'missing-engine',
      engineBotId: `native-${id}`
    })
  return { db, store, engine, bots, activity, observed, observe, addGhost }
}

test('unregistered-engine bot fails fast in use/openChat without starting any readiness retry timers', async () => {
  const f = setup()
  f.addGhost('ghost-1')
  await f.bots.prepareRuntimes()

  const realSetTimeout = globalThis.setTimeout
  let timersScheduled = 0
  globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => {
    timersScheduled++
    return realSetTimeout(...args)
  }) as typeof setTimeout
  try {
    await expect(f.bots.openChat('ghost-1', undefined, () => {})).rejects.toMatchObject({ code: 'runtime_unavailable' })
    expect(timersScheduled).toBe(0)
  } finally {
    globalThis.setTimeout = realSetTimeout
  }
})

test('unregistered-engine routine fails cleanly without working status or retry spin, while healthy routines still run', async () => {
  const f = setup()
  const healthy = await f.bots.createBot({ name: 'Healthy', function: '', instructions: '' })
  f.addGhost('ghost-rt')
  let now = 1_000_000
  const routineStore = new RoutineStore(f.db)
  const routines = new RoutineService(
    routineStore,
    f.bots,
    () => {},
    { minIntervalSeconds: 60, selfCreatedCap: 5 },
    () => now
  )
  const scheduler = new RoutineScheduler(routines, f.observe, () => now)

  await routines.create('ghost-rt', { requestId: 'g1', description: 'Ghost task', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })
  await routines.create(healthy.id, { requestId: 'h1', description: 'Healthy task', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })
  now += 400_000

  const started = scheduler.tick()
  expect(started).toHaveLength(2)
  for (let i = 0; i < 40 && routineStore.pending().length > 0; i++) await Bun.sleep(20)

  const ghostRun = routines.store.list('ghost-rt')[0]!.runs[0]!
  expect(ghostRun.status).toBe('failed')
  expect(ghostRun.result).toContain('engine is not available')
  expect(f.observed.filter(e => e.botId === 'ghost-rt' && e.status === 'working')).toEqual([])
  expect(f.activity.state('ghost-rt').status).not.toBe('working')
  expect(f.activity.state('ghost-rt').unread).toBe(true)

  const healthyRun = routines.store.list(healthy.id)[0]!.runs[0]!
  expect(healthyRun.status).toBe('completed')
  // Subsequent ticks do not spin or re-run the settled ghost routine.
  expect(scheduler.tick()).toEqual([])

  // Clearing unread and hitting another scheduled interval records the failed run without re-raising unread.
  f.activity.setUnread('ghost-rt', false)
  now += 400_000
  expect(scheduler.tick()).toHaveLength(2)
  for (let i = 0; i < 40 && routineStore.pending().length > 0; i++) await Bun.sleep(20)
  expect(routines.store.list('ghost-rt')[0]!.runs).toHaveLength(2)
  expect(routines.store.list('ghost-rt')[0]!.runs.every(r => r.status === 'failed')).toBe(true)
  expect(f.activity.state('ghost-rt').unread).toBe(false)

  // Once the bot's engine returns, the routine succeeds and a later missing-engine outage notifies once again.
  const nativeId = await f.engine.createRuntime(f.store.get('ghost-rt'))
  f.store.bindEngine('ghost-rt', 'scripted-a', nativeId, null)
  now += 400_000
  expect(scheduler.tick()).toHaveLength(2)
  for (let i = 0; i < 40 && routineStore.pending().length > 0; i++) await Bun.sleep(20)
  expect(routines.store.list('ghost-rt')[0]!.runs[0]!.status).toBe('completed')
  f.activity.setUnread('ghost-rt', false)
  f.store.bindEngine('ghost-rt', 'missing-engine', 'native-ghost-rt', null)
  now += 400_000
  expect(scheduler.tick()).toHaveLength(2)
  for (let i = 0; i < 40 && routineStore.pending().length > 0; i++) await Bun.sleep(20)
  expect(f.activity.state('ghost-rt').unread).toBe(true)
  f.activity.close()
})

test('unregistered-engine webhooks fail cleanly on one tick without blocking healthy webhooks or global concurrency', async () => {
  const f = setup()
  const healthy = await f.bots.createBot({ name: 'Healthy', function: '', instructions: '' })
  f.addGhost('ghost-w1')
  f.addGhost('ghost-w2')
  let now = 2_000_000
  const webhookStore = new WebhookStore(f.db)
  const stubSession = () => ({
    sessionMcp: [{ name: 'lilbot', url: 'http://127.0.0.1:0/u', bearerToken: 't', timeoutSeconds: 30, tools: [] }],
    assertSessionMcpReady: () => {},
    onChat: () => {}
  })
  const webhooks = new WebhookService(
    webhookStore,
    f.bots,
    'secret-key',
    'https://hooks.example.test',
    () => {},
    () => now,
    false,
    stubSession
  )
  const scheduler = new RoutineScheduler(webhooks, f.observe, () => now)
  const mk = (botId: string, requestId: string, description: string) => webhooks.create(botId, { requestId, description, source: 'CI', createdBy: 'oscar' })
  const [h1, h2, h3] = [await mk('ghost-w1', 'w1', 'Ghost 1'), await mk('ghost-w2', 'w2', 'Ghost 2'), await mk(healthy.id, 'w3', 'Healthy hook')]

  const deliver = (address: string, payload: unknown) => {
    const live = webhooks.find(address.split('/hook/').at(-1)!)!
    expect(webhooks.receive(live, new TextEncoder().encode(JSON.stringify(payload)), new Headers({ 'content-type': 'application/json' }))).toBe('accepted')
  }
  // Deliver both unregistered webhooks BEFORE the healthy one (exceeds WEBHOOK_LIMITS.concurrent = 2).
  deliver(h1.address, { n: 1 })
  now += 10
  deliver(h2.address, { n: 2 })
  now += 10
  deliver(h3.address, { n: 3 })
  now += 10_000

  const started = scheduler.tick()
  expect(started).toHaveLength(3)
  for (let i = 0; i < 40 && webhookStore.pending().length > 0; i++) await Bun.sleep(20)

  for (const ghostId of ['ghost-w1', 'ghost-w2']) {
    const run = webhookStore.list(ghostId)[0]!.runs[0]!
    expect(run.status).toBe('failed')
    expect(run.result).toContain('engine is not available')
    expect(f.observed.filter(e => e.botId === ghostId && e.status === 'working')).toEqual([])
    expect(f.activity.state(ghostId).status).not.toBe('working')
  }
  const healthyRun = webhookStore.list(healthy.id)[0]!.runs[0]!
  expect(healthyRun.status).toBe('completed')
  expect(webhookStore.pending()).toEqual([])
  expect(scheduler.tick()).toEqual([])
  f.activity.close()
})
