/** Guard coverage for EngineRegistry and switchBotEngine: implicit primary, rollback cache/notify, serialization, effort, busy refusal, and all constructor/switch guards. */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { botBusyReason } from '../../server/app-bot-busy'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { RoutineStore } from '../../server/routines/routine-store'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { LilBotError } from '../../shared/lilbot-error'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function setup(engines?: BotEngine[]) {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-switch-'))
  dirs.push(root)
  const db = openDatabase(join(root, 'lilbot.db'))
  const store = new BotStore(db)
  const prefs = new BotPrefsStore(db)
  const workspaces = new Workspaces(join(root, 'workspaces'))
  const memory = new MemoryService(new MemoryStore(db))
  const activity = new ActivityService(new ActivityStore(db), () => {})
  const routineStore = new RoutineStore(db)
  const webhookStore = new WebhookStore(db)
  const alpha = (engines?.[0] ?? new ScriptedEngine({ id: 'alpha' })) as ScriptedEngine
  const beta = (engines?.[1] ?? new ScriptedEngine({ id: 'beta' })) as ScriptedEngine
  const registry = new EngineRegistry(engines ?? [alpha, beta])
  let changeCount = 0
  const service = new BotService(registry, store, prefs, workspaces, memory, {
    changed: () => changeCount++,
    busyReason: botBusyReason({ database: db, activity, routineStore, webhookStore })
  })
  return { db, store, prefs, activity, routineStore, webhookStore, alpha, beta, service, changes: () => changeCount }
}

test('EngineRegistry constructor enforces non-empty list, non-empty ids, unique ids, and valid defaultEngineId', () => {
  const a = new ScriptedEngine({ id: 'alpha' })
  expect(() => new EngineRegistry([])).toThrow('at least one engine')
  expect(() => new EngineRegistry([new ScriptedEngine({ id: '' })])).toThrow('non-empty id')
  expect(() => new EngineRegistry([a, new ScriptedEngine({ id: 'alpha' })])).toThrow('Duplicate engine id')
  expect(() => new EngineRegistry([a], 'missing')).toThrow('not registered')
})

test('implicitly primary sole bot stays primary and undeletable across switch and rollback', async () => {
  const f = setup()
  const sole = {
    id: 'sole',
    name: 'Chief',
    function: 'Primary',
    instructions: '',
    model: null,
    reasoningEffort: null,
    isDefault: true,
    permissionMode: 'full-access' as const,
    engineId: 'alpha',
    engineBotId: 'default'
  }
  f.store.save(sole)
  await f.service.prepareRuntimes()
  expect(f.prefs.primaryBot()).toBeNull()
  expect((await f.service.listBots())[0]!.isPrimary).toBe(true)

  // Failed switch rolls back primary_bot to null and restores isDefault = true.
  const realOpen = f.beta.openChat.bind(f.beta)
  f.beta.openChat = async () => Promise.reject(new Error('open failed'))
  await expect(f.service.switchEngine('sole', 'beta')).rejects.toThrow('open failed')
  expect(f.prefs.primaryBot()).toBeNull()
  expect(f.store.get('sole').isDefault).toBe(true)
  await expect(f.service.deleteBot({ botId: 'sole' })).rejects.toMatchObject({ code: 'primary_bot' })

  // Successful switch persists primary_bot so the sole bot can never become deletable.
  f.beta.openChat = realOpen
  await f.service.switchEngine('sole', 'beta')
  expect(f.prefs.primaryBot()).toBe('sole')
  expect((await f.service.listBots())[0]!.isPrimary).toBe(true)
  await expect(f.service.deleteBot({ botId: 'sole' })).rejects.toMatchObject({ code: 'primary_bot' })
  f.activity.close()
})

test('switchEngine enforces permissionMode, rolls back DB/cache/orphan runtime with changed(), passes reasoningEffort, and ignores protected_bot on deleteOldRuntime', async () => {
  const alpha = new ScriptedEngine({ id: 'alpha' })
  const beta = new ScriptedEngine({ id: 'beta' })
  const narrow = new ScriptedEngine({ id: 'narrow' })
  ;(narrow as { supportedPermissionModes: readonly string[] }).supportedPermissionModes = ['read-only']
  const f = setup([alpha, beta, narrow])

  const bot = await f.service.createBot({ name: 'Switchy', function: '', instructions: '' })
  await f.service.updateBot({ botId: bot.id, model: { provider: 'scripted', model: 'think' }, reasoningEffort: 'high' })
  await f.service.prepareRuntimes()

  let narrowCreates = 0
  narrow.createRuntime = async () => {
    narrowCreates++
    return 'never'
  }
  await expect(f.service.switchEngine(bot.id, 'narrow')).rejects.toMatchObject({ code: 'unsupported_permission_mode' })
  expect(narrowCreates).toBe(0)

  // Mid-switch failure after bindEngine restores DB, cached runnable state, notifies changed(), and deletes orphan runtime.
  const deletedOrphans: string[] = []
  const origDelete = beta.deleteRuntime.bind(beta)
  beta.deleteRuntime = async id => {
    deletedOrphans.push(id)
    await origDelete(id)
  }
  const origApply = beta.applyIdentity.bind(beta)
  beta.applyIdentity = async () => {
    throw new Error('apply boom')
  }
  const changesBefore = f.changes()
  await expect(f.service.switchEngine(bot.id, 'beta')).rejects.toThrow('apply boom')
  expect(f.store.get(bot.id).engineId).toBe('alpha')
  expect((await f.service.listBots()).find(b => b.id === bot.id)?.runnable).toBe(true)
  expect(f.changes()).toBeGreaterThan(changesBefore)
  expect(deletedOrphans).toHaveLength(1)

  // Successful switch passes reasoningEffort on first open and ignores protected_bot on deleteOldRuntime.
  beta.applyIdentity = origApply
  let openedEffort: string | undefined
  const origOpen = beta.openChat.bind(beta)
  beta.openChat = async (id, chatId, opts, onEvent) => {
    openedEffort = opts.reasoningEffort
    return origOpen(id, chatId, opts, onEvent)
  }
  alpha.deleteRuntime = async () => Promise.reject(new LilBotError('protected_bot', 'Cannot delete default profile'))
  const switched = await f.service.switchEngine(bot.id, 'beta', { deleteOldRuntime: true })
  expect(switched.changed).toBe(true)
  expect(openedEffort).toBe('high')
  f.activity.close()
})

test('concurrent switchEngine calls serialize per bot and create target runtime once', async () => {
  const f = setup()
  const bot = await f.service.createBot({ name: 'Racer', function: '', instructions: '' })
  let creates = 0
  const origCreate = f.beta.createRuntime.bind(f.beta)
  f.beta.createRuntime = async identity => {
    creates++
    await Bun.sleep(25)
    return origCreate(identity)
  }
  const [r1, r2] = await Promise.all([f.service.switchEngine(bot.id, 'beta'), f.service.switchEngine(bot.id, 'beta')])
  expect(creates).toBe(1)
  expect([r1.changed, r2.changed].sort()).toEqual([false, true])
  f.activity.close()
})

test('switchEngine refuses with bot_busy during active turn, routine, webhook, worker/exchange, or group', async () => {
  const f = setup()
  const bot = await f.service.createBot({ name: 'BusyBot', function: '', instructions: '' })

  const expectBusy = () => expect(f.service.switchEngine(bot.id, 'beta')).rejects.toMatchObject({ code: 'bot_busy' })
  let releaseTurn!: () => void
  f.alpha.setTurnHandler(async () => new Promise<string>(resolve => (releaseTurn = () => resolve('done'))))
  const chat = await f.service.openChat(bot.id, undefined, () => {})
  const sending = chat.send('working')
  await expectBusy()
  releaseTurn()
  await sending
  chat.close()

  f.routineStore.create(bot.id, { requestId: 'r1', description: 'd', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' }, 1000, 5)
  const [rtRun] = f.routineStore.claimDue(1_000_000)
  await expectBusy()
  f.routineStore.finish(rtRun!.id, 'completed', 'ok', 1_000_001)

  const wh = f.webhookStore.create(bot.id, { requestId: 'w1', description: 'd', source: 'CI', createdBy: 'oscar' }, null, 1000)
  f.webhookStore.events.add(wh.id, { deliveryId: 'd1', bodyHash: null }, { item: 'x', size: 1, refusal: null }, 1000)
  const [whRun] = f.webhookStore.claimDue(100_000)
  await expectBusy()
  f.webhookStore.finish(whRun!.id, 'completed', 'ok', 100_001)

  f.db.query("INSERT INTO thread_deliveries(id,threadId,sender,target,sourceChat,text,kind,status) VALUES('d1','t1',?,?, 'c','hi','request','pending')").run(bot.id, bot.id)
  await expectBusy()
  f.db.query("UPDATE thread_deliveries SET status='done' WHERE id='d1'").run()

  f.db.query("INSERT INTO threads(id,data) VALUES('g1', ?)").run(JSON.stringify({ id: 'g1', participants: [{ id: bot.id, name: 'BusyBot' }] }))
  f.db.query("INSERT INTO thread_groups(thread_id,leader_id,request_id,source_chat,created_at) VALUES('g1',?,'gr1','c',1000)").run(bot.id)
  await expectBusy()
  f.db.query("UPDATE thread_groups SET ended_at=2000, settled=1 WHERE thread_id='g1'").run()

  expect((await f.service.switchEngine(bot.id, 'beta')).changed).toBe(true)
  f.activity.close()
})
