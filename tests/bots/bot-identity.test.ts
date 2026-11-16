import { expect, test } from 'bun:test'
import { BotRuntimes } from '../../server/bots/bot-runtimes'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { LilBotError } from '../../shared/protocol'
import { detail, fakeEngine, fakeService } from '../helpers/fake-engine'

test('imports all identity fields once, concurrently and across service restarts', async () => {
  const store = new BotStore(openDatabase(':memory:'))
  const { engine } = fakeEngine()
  let calls = 0
  engine.importBots = async () => {
    calls++
    return [{ ...detail, instructions: 'Original', model: { provider: 'p', model: 'm' } }]
  }
  const runtimes = new BotRuntimes(store, engine)
  await Promise.all([runtimes.initialize(), runtimes.initialize()])
  expect(store.get('b1')).toMatchObject({ id: 'b1', instructions: 'Original', model: { provider: 'p', model: 'm' }, engineId: 'test', engineBotId: 'b1' })
  store.save({ ...store.get('b1'), name: 'Edited' })
  await new BotRuntimes(store, engine).initialize()
  expect(calls).toBe(1)
  expect(store.get('b1').name).toBe('Edited')
})

test('failed imports retry without leaving partial identities or an import marker', async () => {
  const store = new BotStore(openDatabase(':memory:'))
  const { engine } = fakeEngine()
  engine.importBots = async () => {
    throw new Error('offline')
  }
  const runtimes = new BotRuntimes(store, engine)
  await expect(runtimes.initialize()).rejects.toThrow('offline')
  expect(store.imported('test')).toBe(false)
  expect(store.list()).toEqual([])
  engine.importBots = async () => [detail]
  await runtimes.initialize()
  expect(store.list()).toHaveLength(1)
})

test('create persists app identity and passes it to the runtime; failed updates remain authoritative', async () => {
  const { service, store, engine, runtimeIds } = fakeService()
  engine.createRuntime = async identity => {
    expect(store.get(identity.id).name).toBe('New')
    runtimeIds.add(identity.id)
    return identity.id
  }
  const made = await service.createBot({ name: 'New', function: 'Purpose', instructions: 'Initial' })
  engine.applyIdentity = async (id, identity) => {
    expect(id).toBe(made.id)
    expect(store.get(made.id).instructions).toBe(identity.instructions)
    throw new Error('offline')
  }
  await expect(service.updateBot({ botId: made.id, name: 'Renamed', instructions: 'Saved despite outage' })).rejects.toThrow('offline')
  expect(store.get(made.id)).toMatchObject({ name: 'Renamed', instructions: 'Saved despite outage' })
  engine.applyIdentity = async (_id, identity) => {
    expect(identity.instructions).toBe('Saved despite outage')
    return { abilities: [], memoryConnected: false }
  }
  expect((await service.getBot(made.id)).name).toBe('Renamed')
})

test('a missing runtime remains in the roster and setup with identity and memory intact', async () => {
  const { service, engine, memory } = fakeService()
  await service.writeMemory({ botId: 'b1', kind: 'profile', text: 'Prefers brief answers.' })
  engine.applyIdentity = async () => {
    throw new LilBotError('bot_not_found', 'Missing runtime')
  }
  expect(await service.listBots()).toMatchObject([{ id: 'b1', name: 'Bot One', runnable: false }])
  expect(await service.getBot('b1')).toMatchObject({ id: 'b1', runnable: false, instructions: '' })
  expect((await service.listMemory('b1')).facts).toHaveLength(1)
  expect(memory.list('b1')).toHaveLength(1)
  await expect(service.openChat('b1', undefined, () => {})).rejects.toThrow('Missing runtime')
  await expect(service.reviewMemory('b1', 'Review', { onChat: () => {} })).rejects.toMatchObject({ code: 'runtime_unavailable' })
})

test('different native ids never leak into workspace, memory, chat snapshots or reviews', async () => {
  const { service, store, engine, runtimeIds, log } = fakeService()
  store.bind('b1', 'native-123')
  runtimeIds.add('native-123')
  const applied: string[] = []
  engine.applyIdentity = async (id, identity) => {
    applied.push(id)
    expect(identity.id).toBe('b1')
    return { abilities: [], memoryConnected: false }
  }
  engine.connectMemory = async (id, connection) => {
    expect(id).toBe('native-123')
    expect(connection.botId).toBe('b1')
    return { aboutUser: [], ownNotes: [] }
  }
  await service.connectMemory('b1')
  const chat = await service.newChat('b1', () => {})
  expect(chat.snapshot.botId).toBe('b1')
  expect(chat.snapshot.workspace.endsWith('/b1')).toBe(true)
  await service.reviewMemory('b1', 'Review', { onChat: () => {} })
  expect(applied).toEqual(['native-123', 'native-123'])
  expect(log).toContain('review:native-123:bot model')
})

test('failed runtime creation keeps a visible bot; unknown engines do not hide identities', async () => {
  const { service, engine, store } = fakeService()
  engine.createRuntime = async () => {
    throw new Error('creation refused')
  }
  await expect(service.createBot({ name: 'Retained', function: '', instructions: '' })).rejects.toThrow('creation refused')
  const created = store.list().find(bot => bot.name === 'Retained')!
  expect((await service.listBots()).find(bot => bot.id === created.id)?.runnable).toBe(false)
  store.save({ ...created, id: 'other-engine', engineId: 'unavailable', engineBotId: 'native' })
  expect((await service.getBot('other-engine')).runnable).toBe(false)
})

test('identity migration preserves populated primary, prefs, main chat, facts, queue, unread and cursors', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { BotPrefsStore } = await import('../../server/bots/bot-prefs-store')
  const { MemoryStore } = await import('../../server/memory/memory-store')
  const { MemoryService } = await import('../../server/memory/memory-service')
  const { ReviewQueue } = await import('../../server/memory/review-queue')
  const dir = mkdtempSync(join(tmpdir(), 'identity-upgrade-'))
  try {
    const path = join(dir, 'lilbot.db')
    const old = openDatabase(path)
    const prefs = new BotPrefsStore(old)
    const section = prefs.createSection('Work')
    prefs.setPrefs('b1', { pinned: true, hidden: true, sectionId: section.id })
    prefs.setMainChat('b1', 'chat-legacy')
    prefs.setPrimaryBot('b1')
    new MemoryService(new MemoryStore(old)).write({ botId: 'b1', text: 'Prefers tea.', kind: 'profile', author: 'user' })
    new ReviewQueue(old).add('b1', 'chat-legacy', 'hello', 'hi', 1)
    old.exec("INSERT INTO bot_activity VALUES ('b1', 1); INSERT INTO activity_cursors VALUES ('b1', 'chat-legacy', 'epoch:12')")
    const tables = ['bot_prefs', 'primary_bot', 'memory_facts', 'review_turns', 'sections', 'bot_activity', 'activity_cursors']
    const before = tables.map(table => old.query(`SELECT * FROM ${table}`).all())
    old.exec('DROP TABLE bots; DROP TABLE bot_imports; PRAGMA user_version = 5')
    old.close()
    const db = openDatabase(path)
    const store = new BotStore(db)
    await new BotRuntimes(store, fakeEngine().engine).initialize()
    expect(tables.map(table => db.query(`SELECT * FROM ${table}`).all())).toEqual(before)
    expect(store.get('b1').id).toBe('b1')
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a failed import transaction leaves no partial records', () => {
  const store = new BotStore(openDatabase(':memory:'))
  const record = { ...detail, engineId: 'test', engineBotId: 'same' }
  expect(() => store.import('test', [record, { ...record, id: 'collision' }])).toThrow()
  expect(store.list()).toEqual([])
  expect(store.imported('test')).toBe(false)
})
