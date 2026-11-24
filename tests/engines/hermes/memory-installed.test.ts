import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../../server/bots/bot-prefs-store'
import { BotService } from '../../../server/bots/bot-service'
import { BotStore } from '../../../server/bots/bot-store'
import { Workspaces } from '../../../server/bots/workspaces'
import { openDatabase } from '../../../server/database/database'
import { memoryInstalled } from '../../../server/engines/hermes/hermes-memory-setup'
import { MemoryService } from '../../../server/memory/memory-service'
import { MemoryStore } from '../../../server/memory/memory-store'
import { detail, fakeEngine } from '../../helpers/fake-engine'

let root = ''
let previous: string | undefined

beforeEach(() => {
  previous = process.env.HERMES_HOME
  root = mkdtempSync(join(tmpdir(), 'memory-installed-'))
  process.env.HERMES_HOME = root
  mkdirSync(join(root, 'profiles', 'existing'), { recursive: true })
})

afterEach(() => {
  if (previous === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previous
  rmSync(root, { recursive: true, force: true })
})

const settingsPath = (profile: string) => (profile === 'default' ? join(root, 'lilbot-memory.json') : join(root, 'profiles', profile, 'lilbot-memory.json'))

test('memoryInstalled compares stored bot_id with expectedBotId and treats missing or unreadable settings as not installed', () => {
  expect(memoryInstalled('existing', 'existing')).toBe(false)
  expect(memoryInstalled('existing', 'bot-uuid')).toBe(false)

  for (const invalid of ['{not json', 'null', '[]', '"text"', '{}', JSON.stringify({ bot_id: '' }), JSON.stringify({ bot_id: 42 }), JSON.stringify({ bot_id: null })]) {
    writeFileSync(settingsPath('existing'), invalid)
    expect(memoryInstalled('existing', 'bot-uuid')).toBe(false)
    expect(memoryInstalled('existing', 'existing')).toBe(false)
  }

  writeFileSync(settingsPath('existing'), JSON.stringify({ url: 'http://127.0.0.1:1', token_file: '/tmp/t', bot_id: 'old-uuid' }))
  expect(memoryInstalled('existing', 'existing')).toBe(false)
  expect(memoryInstalled('existing', 'new-uuid')).toBe(false)
  expect(memoryInstalled('existing', 'old-uuid')).toBe(true)

  writeFileSync(settingsPath('default'), JSON.stringify({ url: 'http://127.0.0.1:1', token_file: '/tmp/t' }))
  expect(memoryInstalled('default', 'default')).toBe(true)
  expect(memoryInstalled('default', 'new-uuid')).toBe(false)

  writeFileSync(settingsPath('default'), JSON.stringify({ url: 'http://127.0.0.1:1', token_file: '/tmp/t', bot_id: 'default' }))
  expect(memoryInstalled('default', 'default')).toBe(true)
  expect(memoryInstalled('default', 'new-uuid')).toBe(false)
})

test('a fresh database importing a profile with stale lilbot-memory.json reconnects memory under the new random bot id', async () => {
  const tokenFile = join(root, 'engine-token')
  writeFileSync(tokenFile, 'test-token')
  writeFileSync(settingsPath('existing'), JSON.stringify({ url: 'http://127.0.0.1:9999', token_file: '/stale/token', bot_id: 'old-bot-id', creation_capability: 'stale' }))

  const db = openDatabase(':memory:')
  try {
    const store = new BotStore(db)
    const prefs = new BotPrefsStore(db)
    const memory = new MemoryService(new MemoryStore(db))
    const { engine, runtimeIds } = fakeEngine()
    runtimeIds.add('existing')
    engine.importBots = async () => [{ ...detail, id: 'existing', name: 'Existing', isDefault: true }]
    engine.applyIdentity = async (engineBotId, identity) => ({ abilities: [], memoryConnected: memoryInstalled(engineBotId, identity.id) })
    engine.connectMemory = async (engineBotId, connection) => {
      writeFileSync(settingsPath(engineBotId), JSON.stringify({ url: connection.url, checkpoint_key: connection.checkpointKey, bot_id: connection.botId ?? engineBotId }))
      return { aboutUser: [], ownNotes: [] }
    }

    const connectionFor = (id: string) => ({ url: 'http://127.0.0.1:3370', checkpointKey: `key-${id}`, botId: id })
    const service = new BotService(engine, store, prefs, new Workspaces(join(root, 'workspaces')), memory, { memoryConnection: connectionFor })
    await service.prepareRuntimes()
    const [bot] = store.list()
    expect(bot.engineBotId).toBe('existing')
    expect(bot.id).not.toBe('existing')
    expect(bot.id).not.toBe('old-bot-id')
    expect((await service.listMemory(bot.id)).connected).toBe(false)

    const connected = await service.connectAllMemory()
    expect(connected).toEqual([bot.id])
    expect((await service.listMemory(bot.id)).connected).toBe(true)
    expect(JSON.parse(readFileSync(settingsPath('existing'), 'utf8'))).toEqual({
      url: 'http://127.0.0.1:3370',
      checkpoint_key: `key-${bot.id}`,
      bot_id: bot.id
    })

    // A subsequent start sees the matching bot_id and skips reconnecting.
    const next = new BotService(engine, store, prefs, new Workspaces(join(root, 'workspaces')), memory, { memoryConnection: connectionFor })
    await next.prepareRuntimes()
    expect((await next.listMemory(bot.id)).connected).toBe(true)
    expect(await next.connectAllMemory()).toEqual([])
  } finally {
    db.close()
  }
})

test('an already-imported database where bot id equals engine id stays connected without rewriting lilbot-memory.json', async () => {
  for (const existingSettings of [
    { url: 'http://127.0.0.1:3370', token_file: '/t', bot_id: 'default', creation_capability: 'cap' },
    { url: 'http://127.0.0.1:3370', token_file: '/t' }
  ]) {
    const raw = JSON.stringify(existingSettings)
    writeFileSync(settingsPath('default'), raw)
    const db = openDatabase(':memory:')
    try {
      const store = new BotStore(db)
      store.import('test', [{ ...detail, id: 'default', name: 'Chief', isDefault: true, engineId: 'test', engineBotId: 'default' }])
      const { engine, runtimeIds } = fakeEngine()
      runtimeIds.add('default')
      engine.applyIdentity = async (engineBotId, identity) => ({ abilities: [], memoryConnected: memoryInstalled(engineBotId, identity.id) })
      let connectCalls = 0
      engine.connectMemory = async () => {
        connectCalls++
        return { aboutUser: [], ownNotes: [] }
      }
      const service = new BotService(engine, store, new BotPrefsStore(db), new Workspaces(join(root, 'workspaces')), new MemoryService(new MemoryStore(db)), {
        memoryConnection: id => ({ url: 'http://127.0.0.1:3370', checkpointKey: `key-${id}`, botId: id })
      })
      await service.prepareRuntimes()
      expect((await service.listMemory('default')).connected).toBe(true)
      expect(await service.connectAllMemory()).toEqual([])
      expect(connectCalls).toBe(0)
      expect(readFileSync(settingsPath('default'), 'utf8')).toBe(raw)
    } finally {
      db.close()
    }
  }
})

test('an equal-id bot with an empty or blank-id settings object is reported disconnected and repaired by connectAllMemory', async () => {
  for (const broken of [{}, { bot_id: '' }]) {
    writeFileSync(settingsPath('default'), JSON.stringify(broken))
    const db = openDatabase(':memory:')
    try {
      const store = new BotStore(db)
      store.import('test', [{ ...detail, id: 'default', name: 'Chief', isDefault: true, engineId: 'test', engineBotId: 'default' }])
      const { engine, runtimeIds } = fakeEngine()
      runtimeIds.add('default')
      engine.applyIdentity = async (engineBotId, identity) => ({ abilities: [], memoryConnected: memoryInstalled(engineBotId, identity.id) })
      engine.connectMemory = async (engineBotId, connection) => {
        writeFileSync(settingsPath(engineBotId), JSON.stringify({ url: connection.url, checkpoint_key: connection.checkpointKey, bot_id: connection.botId ?? engineBotId }))
        return { aboutUser: [], ownNotes: [] }
      }
      const service = new BotService(engine, store, new BotPrefsStore(db), new Workspaces(join(root, 'workspaces')), new MemoryService(new MemoryStore(db)), {
        memoryConnection: id => ({ url: 'http://127.0.0.1:3370', checkpointKey: `key-${id}`, botId: id })
      })
      await service.prepareRuntimes()
      expect((await service.listMemory('default')).connected).toBe(false)
      expect(await service.connectAllMemory()).toEqual(['default'])
      expect((await service.listMemory('default')).connected).toBe(true)
      expect(JSON.parse(readFileSync(settingsPath('default'), 'utf8'))).toEqual({ url: 'http://127.0.0.1:3370', checkpoint_key: 'key-default', bot_id: 'default' })
    } finally {
      db.close()
    }
  }
})
