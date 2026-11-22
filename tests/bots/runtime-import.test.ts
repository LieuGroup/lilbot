import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityStore } from '../../server/activity/activity-store'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotRuntimes } from '../../server/bots/bot-runtimes'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { sessionRoots } from '../../server/bots/hidden-chats'
import { importBots } from '../../server/bots/runtime-import'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { ThreadStore } from '../../server/threads/thread-store'
import { detail, fakeEngine } from '../helpers/fake-engine'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

test('imported bots always get fresh random ids distinct from their engine ids, and the default stays primary', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-import-'))
  const db = openDatabase(':memory:')
  try {
    const store = new BotStore(db)
    const { engine, runtimeIds } = fakeEngine()
    const uuidLike = crypto.randomUUID()
    const engineBots = [
      { ...detail, id: 'default', name: 'Chief', isDefault: true },
      { ...detail, id: 'researcher', name: 'Researcher', isDefault: false },
      { ...detail, id: uuidLike, name: 'Existing UUID', isDefault: false }
    ]
    for (const entry of engineBots) runtimeIds.add(entry.id)
    engine.importBots = async () => engineBots

    await importBots(store, engine)
    const imported = store.list()
    expect(imported).toHaveLength(3)
    expect(new Set(imported.map(bot => bot.id)).size).toBe(3)
    for (const bot of imported) {
      expect(bot.id).toMatch(UUID)
      expect(bot.id).not.toBe(bot.engineBotId)
      expect(bot.engineId).toBe('test')
    }
    expect(imported.map(bot => bot.engineBotId).sort()).toEqual(['default', 'researcher', uuidLike].sort())

    const service = new BotService(engine, store, new BotPrefsStore(db), new Workspaces(root), new MemoryService(new MemoryStore(db)))
    const listed = await service.listBots()
    const primary = listed.find(bot => bot.isPrimary)
    expect(primary).toBeDefined()
    expect(primary?.id).not.toBe('default')
    expect(store.get(primary!.id).engineBotId).toBe('default')
    expect(primary?.workspace).toBe(join(root, primary!.id))

    const seenCalls: Array<[string, string]> = []
    engine.compressionRoot = (engineBotId, chatId) => {
      seenCalls.push([engineBotId, chatId])
      return chatId === 'worker-compressed' ? 'worker-root' : chatId
    }
    const threads = new ThreadStore(db, sessionRoots(engine, store))
    const delivery = threads.accept(primary!, primary!, { requestId: 'w1', text: 'Run worker', chatId: 'main-chat', worker: true })
    threads.attach(delivery, primary!.id, 'worker-root', true)
    expect(() => threads.assertNotWorker(primary!.id, 'worker-compressed', true)).toThrow('A worker cannot start another worker')
    expect(seenCalls).toEqual([
      ['default', 'main-chat'],
      ['default', 'worker-compressed']
    ])
  } finally {
    db.close()
    rmSync(root, { recursive: true, force: true })
  }
})

test('an already-imported database whose bot id equals its engine id keeps working untouched without re-importing', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-legacy-'))
  const dbPath = join(root, 'lilbot.db')
  try {
    const seed = openDatabase(dbPath)
    const seedStore = new BotStore(seed)
    seedStore.import('test', [{ ...detail, id: 'default', name: 'Chief', isDefault: true, engineId: 'test', engineBotId: 'default' }])
    const seedPrefs = new BotPrefsStore(seed)
    seedPrefs.setPrefs('default', { pinned: true })
    seedPrefs.setMainChat('default', 'chat-existing')
    new MemoryService(new MemoryStore(seed)).write({ botId: 'default', kind: 'profile', text: 'Existing fact.', author: 'user' })
    new ActivityStore(seed).accept('default', 'chat-existing', 'epoch:7')
    seed.close()

    const db = openDatabase(dbPath)
    try {
      const store = new BotStore(db)
      const prefs = new BotPrefsStore(db)
      const memory = new MemoryService(new MemoryStore(db))
      const { engine, runtimeIds, stored } = fakeEngine()
      runtimeIds.add('default')
      stored.add('chat-existing')
      let importCalls = 0
      engine.importBots = async () => {
        importCalls++
        throw new Error('must not import again')
      }

      const service = new BotService(engine, store, prefs, new Workspaces(join(root, 'workspaces')), memory)
      await service.prepareRuntimes()
      await new BotRuntimes(store, engine).initialize()
      expect(importCalls).toBe(0)
      expect(store.list().map(bot => ({ id: bot.id, engineBotId: bot.engineBotId }))).toEqual([{ id: 'default', engineBotId: 'default' }])

      const listed = await service.listBots()
      expect(listed).toMatchObject([{ id: 'default', name: 'Chief', isPrimary: true, runnable: true, prefs: { pinned: true } }])
      expect((await service.listMemory('default')).facts.map(fact => fact.text)).toEqual(['Existing fact.'])
      expect(new ActivityStore(db).cursor('default', 'chat-existing')).toBe('epoch:7')

      const chat = await service.openChat('default', undefined, () => {})
      expect(chat.snapshot.botId).toBe('default')
      expect(chat.snapshot.chatId).toBe('chat-existing')
      chat.close()
    } finally {
      db.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
