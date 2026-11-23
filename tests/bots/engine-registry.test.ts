/** Multi-engine registry, unavailable-engine isolation, primary-only deletion, and service-level switchEngine (P6). */
import { afterAll, expect, test } from 'bun:test'
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
import type { BotEngine } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { SkillsService } from '../../server/skills/skills-service'
import { LilBotError } from '../../shared/lilbot-error'
import { fakeEngine } from '../helpers/fake-engine'

function namedEngine(id: string, models: string[] = ['m1']) {
  const f = fakeEngine()
  let nextChat = 0
  const chats = new Set<string>()
  const engine: BotEngine = {
    ...f.engine,
    id,
    importBots: async () => [],
    listModels: async () => [{ provider: id, name: id, models, capabilities: models.map(m => ({ id: m, reasoning: true, canDisableReasoning: true })) }],
    validateModel: async model => {
      if (model.provider !== id || !models.includes(model.model)) throw new LilBotError('invalid_model', `Unknown model ${model.provider}::${model.model}`)
    },
    openChat: async (botId, chatId, chatOptions) => {
      const nextId = chatId && chats.has(chatId) ? chatId : `${id}-chat-${++nextChat}`
      chats.add(nextId)
      f.log.push(`open:${nextId}`)
      return {
        snapshot: { chatId: nextId, botId, title: '', running: false, workspace: chatOptions.workspace, items: [] },
        send: async text => void f.log.push(`send:${nextId}:${text}`),
        stop: async () => void f.log.push(`stop:${nextId}`),
        close: () => void f.log.push(`close:${nextId}`)
      }
    }
  }
  return { ...f, engine }
}

function multiEngineService(engines: EngineRegistry) {
  const database = openDatabase(':memory:')
  const store = new BotStore(database)
  const prefs = new BotPrefsStore(database)
  const memory = new MemoryService(new MemoryStore(database))
  const root = mkdtempSync(join(tmpdir(), 'lilbot-reg-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const skills = new SkillsService(join(root, 'skills'), database)
  const history = new HistoryService(
    new HistoryStore(database),
    engines,
    async () => store.list().filter(b => engines.has(b.engineId)),
    () => true
  )
  const activity = new ActivityService(new ActivityStore(database), () => {})
  let changes = 0
  const service = new BotService(engines, store, prefs, new Workspaces(root), memory, {
    skills,
    history,
    changed: () => changes++,
    memoryConnection: { url: 'http://127.0.0.1:3999', tokenFile: '/nowhere/engine-token' }
  })
  return { database, store, prefs, memory, skills, history, activity, service, changes: () => changes }
}

test('multiple engines coexist, route bots by engineId, and isolate bots on unregistered engines', async () => {
  const a = namedEngine('alpha', ['a1'])
  const b = namedEngine('beta', ['b1'])
  const registry = new EngineRegistry([a.engine, b.engine])
  const f = multiEngineService(registry)

  const botA = await f.service.createBot({ name: 'Alpha Bot', function: 'A', instructions: '' }, undefined, 'alpha')
  const botB = await f.service.createBot({ name: 'Beta Bot', function: 'B', instructions: '' }, undefined, 'beta')
  // Persist a bot bound to an engine that is NOT registered on this server.
  f.store.save({
    id: 'ghost-bot',
    name: 'Ghost',
    function: 'Unregistered engine',
    instructions: '',
    model: null,
    reasoningEffort: null,
    isDefault: false,
    permissionMode: 'full-access',
    engineId: 'missing-engine',
    engineBotId: 'native-ghost'
  })

  await f.service.prepareRuntimes()
  const listed = await f.service.listBots()
  expect(listed.find(bot => bot.id === botA.id)).toMatchObject({ runnable: true, runtimePending: false })
  expect(listed.find(bot => bot.id === botB.id)).toMatchObject({ runnable: true, runtimePending: false })
  expect(listed.find(bot => bot.id === 'ghost-bot')).toMatchObject({ runnable: false, runtimePending: false })

  // Registered bots chat independently on their own engines.
  const chatA = await f.service.openChat(botA.id, undefined, () => {})
  await chatA.send('hello alpha')
  chatA.close()
  const chatB = await f.service.openChat(botB.id, undefined, () => {})
  await chatB.send('hello beta')
  chatB.close()
  expect(a.log.some(entry => entry.includes('hello alpha'))).toBe(true)
  expect(b.log.some(entry => entry.includes('hello beta'))).toBe(true)

  // Unregistered bot fails cleanly with runtime_unavailable and can still be deleted when not primary.
  await expect(f.service.openChat('ghost-bot', undefined, () => {})).rejects.toThrow('engine is not available')
  await f.service.deleteBot({ botId: 'ghost-bot' })
  expect(f.store.exists('ghost-bot')).toBe(false)
  expect(f.service.skills?.engines().map(e => e.id)).toEqual(['alpha', 'beta'])
  expect((await f.service.listModels('beta'))[0].models).toEqual(['b1'])
})

test('switchEngine moves a bot to another engine with a fresh session, kept history, and engine_switched divider', async () => {
  const a = namedEngine('alpha', ['a1'])
  const b = namedEngine('beta', ['b1'])
  const registry = new EngineRegistry([a.engine, b.engine])
  const f = multiEngineService(registry)

  const bot = await f.service.createBot({ name: 'Mover', function: 'Swaps cleanly', instructions: 'Stay sharp.', model: { provider: 'alpha', model: 'a1' } }, undefined, 'alpha')
  f.memory.write({ botId: bot.id, kind: 'profile', scope: 'bot', text: 'Keep this fact.', author: 'user' })
  const first = await f.service.openChat(bot.id, undefined, () => {})
  await first.send('message before switch')
  f.history.store.session(bot.id, first.snapshot.chatId, 1000)
  f.history.store.write(bot.id, first.snapshot.chatId, [{ id: 'm1', at: 1001, order: 0, item: { kind: 'user', text: 'message before switch' } }])
  first.close()

  // Incompatible model on target engine is rejected without mutating DB binding.
  await expect(f.service.switchEngine(bot.id, 'beta')).rejects.toThrow('Unknown model')
  expect(f.store.get(bot.id).engineId).toBe('alpha')
  // Unregistered target engine is rejected without mutating DB binding.
  await expect(f.service.switchEngine(bot.id, 'unknown')).rejects.toThrow('engine is not available')
  expect(f.store.get(bot.id).engineId).toBe('alpha')

  // Switching to same engine is a no-op.
  const noop = await f.service.switchEngine(bot.id, 'alpha')
  expect(noop.changed).toBe(false)

  // Valid switch with target model succeeds, opens fresh session, keeps history & memory, and writes divider.
  const switched = await f.service.switchEngine(bot.id, 'beta', { model: { provider: 'beta', model: 'b1' }, deleteOldRuntime: true })
  expect(switched.changed).toBe(true)
  expect(switched.bot.engineId).toBe('beta')
  expect(switched.chatId).toBeTruthy()
  expect(switched.chatId).not.toBe(first.snapshot.chatId)
  expect(f.prefs.mainChat(bot.id)).toBe(switched.chatId)
  expect(a.log.some(entry => entry.startsWith('delete:'))).toBe(true)

  const page = await f.service.historyPage(bot.id)
  expect(page.items.some(row => row.item.kind === 'user' && row.item.text === 'message before switch')).toBe(true)
  expect(page.items.some(row => row.item.kind === 'session' && row.item.reason === 'engine_switched')).toBe(true)
  expect(f.memory.list(bot.id).some(fact => fact.text === 'Keep this fact.')).toBe(true)

  // Next chat runs on beta.
  const next = await f.service.openChat(bot.id, undefined, () => {})
  expect(next.snapshot.chatId).toBe(switched.chatId!)
  await next.send('message after switch')
  next.close()
  expect(b.log.some(entry => entry.includes('message after switch'))).toBe(true)
})
