import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'

const input = { requestId: 'one', name: 'Engineer', function: 'Keeps TypeScript projects tidy.', instructions: 'Help Oscar maintain TypeScript projects.' }

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function setupTwoEngines() {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-bot-create-engines-'))
  const workspacesDir = join(root, 'workspaces')
  const database = openDatabase(join(root, 'lilbot.db'))
  cleanups.push(() => {
    database.close()
    rmSync(root, { recursive: true, force: true })
  })
  const engineA = new ScriptedEngine({ id: 'engine-a', models: [{ provider: 'alpha', name: 'Alpha', models: ['alpha-1'], capabilities: [] }] })
  const engineB = new ScriptedEngine({ id: 'engine-b', models: [{ provider: 'beta', name: 'Beta', models: ['beta-1'], capabilities: [] }] })
  const createdRuntimes: { engine: string; id: string }[] = []
  for (const engine of [engineA, engineB]) {
    const orig = engine.createRuntime.bind(engine)
    engine.createRuntime = async identity => {
      const nativeId = await orig(identity)
      createdRuntimes.push({ engine: engine.id, id: nativeId })
      return nativeId
    }
  }
  const registry = new EngineRegistry([engineA, engineB], 'engine-a')
  const store = new BotStore(database)
  const prefs = new BotPrefsStore(database)
  const service = new BotService(registry, store, prefs, new Workspaces(workspacesDir), new MemoryService(new MemoryStore(database)))
  return { engineA, engineB, store, prefs, service, workspacesDir, createdRuntimes }
}

const workspaceDirs = (dir: string) => (existsSync(dir) ? readdirSync(dir) : [])

test('a bot created by a bot on a non-default engine inherits its creator’s engine as well as its model', async () => {
  const { engineA, engineB, store, prefs, service } = setupTwoEngines()
  const betaModel = { provider: 'beta', model: 'beta-1' }
  const creator = await service.createBot({ name: 'Beta Lead', function: '', instructions: '', model: betaModel }, 'creator-b', 'engine-b')
  const plainCreator = await service.createBot({ name: 'Beta Plain', function: '', instructions: '' }, 'creator-b-plain', 'engine-b')

  const child = await service.createFromBot(creator.id, { ...input, requestId: 'from-beta' })
  const childRecord = store.get(child.id)
  expect(childRecord.engineId).toBe('engine-b')
  expect(childRecord.model).toEqual(betaModel)
  expect(engineB.runtimeOf(childRecord.engineBotId)).toBeDefined()
  expect(engineA.runtimeOf(childRecord.engineBotId)).toBeUndefined()
  const mainChat = prefs.mainChat(child.id)
  expect(mainChat).toBeTruthy()
  expect(engineB.sessionOf(mainChat!)?.inputs[0]?.inputId).toBe(`greeting-${child.id}`)

  // Even without an explicit model on the creator, the child inherits the creator's engine rather than the default engine.
  const plainChild = await service.createFromBot(plainCreator.id, { ...input, requestId: 'from-beta-plain' })
  expect(store.get(plainChild.id).engineId).toBe('engine-b')
  expect(engineB.runtimeOf(store.get(plainChild.id).engineBotId)).toBeDefined()
})

test('creation validates the model against the target engine before saving any row, runtime, or workspace', async () => {
  const { store, service, workspacesDir, createdRuntimes } = setupTwoEngines()
  const badModel = { provider: 'alpha', model: 'alpha-1' }

  // Direct createBot with a model that engine-b does not have refuses cleanly with zero side effects.
  await expect(service.createBot({ name: 'Wrong Model', function: '', instructions: '', model: badModel }, 'direct-bad', 'engine-b')).rejects.toMatchObject({
    code: 'invalid_model'
  })
  expect(store.list()).toHaveLength(0)
  expect(createdRuntimes).toHaveLength(0)
  expect(workspaceDirs(workspacesDir)).toHaveLength(0)

  // A creator on engine-b carrying a stale model unavailable on engine-b is refused before saving anything.
  const creator = await service.createBot({ name: 'Beta Lead', function: '', instructions: '' }, 'creator-b', 'engine-b')
  store.save({ ...store.get(creator.id), model: badModel })
  const runtimesBefore = createdRuntimes.length
  const workspacesBefore = workspaceDirs(workspacesDir)

  await expect(service.createFromBot(creator.id, { ...input, requestId: 'bad-inherited-model' })).rejects.toMatchObject({ code: 'invalid_model' })
  expect(store.list().map(b => b.id)).toEqual([creator.id])
  expect(createdRuntimes).toHaveLength(runtimesBefore)
  expect(workspaceDirs(workspacesDir)).toEqual(workspacesBefore)
})

test('a creator on an unregistered engine is refused before saving any row, runtime, or workspace', async () => {
  const { store, service, workspacesDir, createdRuntimes } = setupTwoEngines()
  store.save({
    id: 'orphan-creator',
    name: 'Orphan',
    function: '',
    instructions: '',
    model: null,
    isDefault: false,
    reasoningEffort: null,
    permissionMode: 'full-access',
    engineId: 'missing-engine',
    engineBotId: 'native-orphan'
  })

  await expect(service.createFromBot('orphan-creator', { ...input, requestId: 'from-missing' })).rejects.toMatchObject({ code: 'runtime_unavailable' })
  expect(store.list().map(b => b.id)).toEqual(['orphan-creator'])
  expect(createdRuntimes).toHaveLength(0)
  expect(workspaceDirs(workspacesDir)).toHaveLength(0)
})
