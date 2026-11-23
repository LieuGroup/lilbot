/** Missing-engine failure transcript semantics and multi-engine registry routing for routine and webhook transcripts. */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})
const waitUntil = async (done: () => boolean) => {
  for (let i = 0; i < 40 && !done(); i++) await Bun.sleep(20)
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-tr-reg-'))
  dirs.push(root)
  const db = openDatabase(join(root, 'lilbot.db'))
  const store = new BotStore(db)
  const [engineA, engineB] = [new ScriptedEngine({ id: 'scripted-a' }), new ScriptedEngine({ id: 'scripted-b' })]
  const memory = {
    list: () => [],
    forgetPrivate: () => {},
    contextBlock: () => '',
    write: () => {
      throw new Error('unused')
    }
  } as any
  const bots = new BotService(new EngineRegistry([engineA, engineB]), store, new BotPrefsStore(db), new Workspaces(join(root, 'workspaces')), memory)
  const addGhost = (id: string) =>
    store.save({
      id,
      name: `Ghost ${id}`,
      function: '',
      instructions: '',
      model: null,
      reasoningEffort: null,
      isDefault: false,
      permissionMode: 'full-access',
      engineId: 'missing-engine',
      engineBotId: `native-${id}`
    })
  return { db, store, engineA, engineB, bots, addGhost }
}

test('missing-engine routine and webhook runs save a result line, no transcript, and are never marked missing by backfill', async () => {
  const f = setup()
  const healthy = await f.bots.createBot({ name: 'Healthy', function: '', instructions: '' }, undefined, 'scripted-a')
  f.addGhost('ghost-1')
  let now = 1_000_000
  const routineStore = new RoutineStore(f.db)
  const routines = new RoutineService(
    routineStore,
    f.bots,
    () => {},
    { minIntervalSeconds: 60, selfCreatedCap: 5 },
    () => now
  )
  const rSched = new RoutineScheduler(
    routines,
    () => {},
    () => now
  )
  const webhookStore = new WebhookStore(f.db)
  const webhooks = new WebhookService(
    webhookStore,
    f.bots,
    'secret',
    'https://hooks.example.test',
    () => {},
    () => now
  )
  const wSched = new RoutineScheduler(
    webhooks,
    () => {},
    () => now
  )

  const ghostRoutine = await routines.create('ghost-1', { requestId: 'gr1', description: 'Ghost routine', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })
  const healthyRoutine = await routines.create(healthy.id, { requestId: 'hr1', description: 'Healthy routine', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })
  const ghostHook = await webhooks.create('ghost-1', { requestId: 'gw1', description: 'Ghost hook', source: 'CI', createdBy: 'oscar' })

  const live = webhooks.find(ghostHook.address.split('/hook/').at(-1)!)!
  webhooks.receive(live, new TextEncoder().encode(JSON.stringify({ ok: 1 })), new Headers({ 'content-type': 'application/json' }))
  now += 400_000
  rSched.tick()
  wSched.tick()
  await waitUntil(() => routineStore.pending().length === 0 && webhookStore.pending().length === 0)

  const ghostRun = routineStore.list('ghost-1')[0]!.runs[0]!
  expect(ghostRun).toMatchObject({ status: 'failed', chatId: null })
  expect(ghostRun.result).toContain('engine is not available')
  expect(routineStore.transcripts.get(ghostRun.id)).toBeNull()

  const ghostHookRun = webhookStore.list('ghost-1')[0]!.runs[0]!
  expect(ghostHookRun).toMatchObject({ status: 'failed', chatId: null })
  expect(ghostHookRun.result).toContain('engine is not available')
  expect(webhookStore.transcripts.get(ghostHookRun.id)).toBeNull()

  // Attached in-flight run settled after engine vanished + unbackfilled healthy run.
  const healthyChat = await f.engineA.openChat(f.store.get(healthy.id).engineBotId, null, { workspace: '/tmp' }, () => {})
  await healthyChat.send('pre-migration run')
  const healthyChatId = healthyChat.snapshot.chatId
  healthyChat.close()

  f.db
    .query("INSERT INTO routine_runs (id, routine_id, bot_id, due_at, started_at, chat_id, status) VALUES ('attached-ghost', ?, 'ghost-1', ?, ?, 'ghost-chat', 'running')")
    .run(ghostRoutine.id, now + 5000, now + 5000)
  f.db
    .query(
      "INSERT INTO routine_runs (id, routine_id, bot_id, due_at, started_at, finished_at, chat_id, status, result) VALUES ('legacy-healthy', ?, ?, ?, ?, ?, ?, 'completed', 'ok')"
    )
    .run(healthyRoutine.id, healthy.id, now + 1000, now + 1000, now + 1500, healthyChatId)

  rSched.tick()
  await waitUntil(() => routineStore.pending().length === 0)
  for (let i = 0; i < 10 && !routineStore.transcripts.get('legacy-healthy'); i++) {
    routines.backfillTick()
    await Bun.sleep(20)
  }

  expect(routineStore.run('ghost-1', 'attached-ghost').status).toBe('failed')
  expect(routineStore.run('ghost-1', 'attached-ghost').result).toContain('engine is not available')
  expect(routineStore.transcripts.get('attached-ghost')).toBeNull()
  expect(routineStore.transcripts.get('legacy-healthy')?.status).toBe('saved')

  await expect(routines.openRun('ghost-1', 'attached-ghost', () => {})).rejects.toMatchObject({ code: 'runtime_unavailable' })
  expect(routineStore.transcripts.get('attached-ghost')).toBeNull()

  // Once the engine returns, backfill recovers the attached run's transcript.
  const ghostNative = await f.engineB.createRuntime(f.store.get('ghost-1'))
  const ghostChat = await f.engineB.openChat(ghostNative, null, { workspace: '/tmp' }, () => {})
  await ghostChat.send('recovered ghost chat')
  f.db.query("UPDATE routine_runs SET chat_id = ? WHERE id = 'attached-ghost'").run(ghostChat.snapshot.chatId)
  ghostChat.close()
  f.store.bindEngine('ghost-1', 'scripted-b', ghostNative, null)
  for (let i = 0; i < 10 && !routineStore.transcripts.get('attached-ghost'); i++) {
    routines.backfillTick()
    await Bun.sleep(20)
  }
  expect(routineStore.transcripts.get('attached-ghost')?.status).toBe('saved')
})

test('each bot runs routines through its own registry engine and saved transcripts survive switchEngine', async () => {
  const f = setup()
  const botA = await f.bots.createBot({ name: 'Alpha', function: '', instructions: '' }, undefined, 'scripted-a')
  const botB = await f.bots.createBot({ name: 'Beta', function: '', instructions: '' }, undefined, 'scripted-b')
  f.engineA.setTurnHandler(async () => 'from engine A')
  f.engineB.setTurnHandler(async () => 'from engine B')

  let now = 3_000_000
  const routineStore = new RoutineStore(f.db)
  const routines = new RoutineService(
    routineStore,
    f.bots,
    () => {},
    { minIntervalSeconds: 60, selfCreatedCap: 5 },
    () => now
  )
  const rSched = new RoutineScheduler(
    routines,
    () => {},
    () => now
  )
  await routines.create(botA.id, { requestId: 'ra', description: 'Task A', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })
  await routines.create(botB.id, { requestId: 'rb', description: 'Task B', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' })

  now += 400_000
  rSched.tick()
  await waitUntil(() => routineStore.pending().length === 0)

  expect(f.engineA.routineCalls.map(c => c.nativeId)).toEqual([f.store.get(botA.id).engineBotId])
  expect(f.engineB.routineCalls.map(c => c.nativeId)).toEqual([f.store.get(botB.id).engineBotId])
  const [runA, runB] = [routineStore.list(botA.id)[0]!.runs[0]!, routineStore.list(botB.id)[0]!.runs[0]!]

  await f.bots.switchEngine(botA.id, 'scripted-b')
  f.engineA.dropSessions()
  const [openA, openB] = await Promise.all([routines.openRun(botA.id, runA.id, () => {}), routines.openRun(botB.id, runB.id, () => {})])
  expect(openA.snapshot.items.some(item => item.kind === 'assistant' && item.text === 'from engine A')).toBe(true)
  expect(openB.snapshot.items.some(item => item.kind === 'assistant' && item.text === 'from engine B')).toBe(true)
  openA.close()
  openB.close()
})
