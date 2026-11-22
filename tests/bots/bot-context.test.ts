import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import type { ModelProvider } from '../../shared/bot-schema'
import { bot, detail, fakeEngine, fakeService, nativeBotId } from '../helpers/fake-engine'

const providers: ModelProvider[] = [
  {
    provider: 'p',
    name: 'P',
    models: ['m1', 'm2'],
    capabilities: [
      { id: 'm1', reasoning: true, canDisableReasoning: null },
      { id: 'm2', reasoning: true, canDisableReasoning: null }
    ]
  }
]

test('main-conversation context is reported on bots.list, bots.get and chat.open, resets on chat.new, and ignores non-main chats', async () => {
  const f = fakeService()
  f.models.value = providers
  await f.service.prepareRuntimes()
  expect((await f.service.getBot('b1')).context).toBeUndefined()
  expect((await f.service.listBots())[0].context).toBeUndefined()

  const original = f.engine.openChat
  let reportCtx: ((c: { used?: number; window?: number | null }) => void) | undefined
  f.engine.openChat = async (botId, chatId, options, onEvent) => {
    reportCtx = options.onContext
    options.onContext?.(chatId ? { window: 200_000 } : { used: 0, window: 200_000 })
    return original(botId, chatId, options, onEvent)
  }

  const main = await f.service.openChat('b1', undefined, () => {})
  expect(main.snapshot.context).toEqual({ used: 0, window: 200_000 })
  expect((await f.service.getBot('b1')).context).toEqual({ used: 0, window: 200_000 })
  expect((await f.service.listBots())[0].context).toEqual({ used: 0, window: 200_000 })

  // Turn finishes on main chat -> updates bot context and notifies listeners once per change.
  const beforeTurn = f.changes()
  f.emit(main.snapshot.chatId, {
    type: 'turn.finished',
    status: 'completed',
    text: 'done',
    usage: { inputTokens: 100, cacheReadTokens: 10_000, outputTokens: 50, contextTokens: 14_500, contextWindow: 200_000 }
  })
  expect((await f.service.getBot('b1')).context).toEqual({ used: 14_500, window: 200_000 })
  expect(f.changes()).toBe(beforeTurn + 1)

  // Duplicate context report does not push another bots.changed.
  reportCtx?.({ used: 14_500, window: 200_000 })
  expect(f.changes()).toBe(beforeTurn + 1)

  // Opening a non-main chat (e.g. routine run) leaves main context untouched.
  await f.service.openChat('b1', 'routine-1', () => {}, true)
  f.emit('routine-1', { type: 'turn.finished', status: 'completed', text: 'ok', usage: { contextTokens: 999, contextWindow: 64_000 } })
  expect((await f.service.getBot('b1')).context).toEqual({ used: 14_500, window: 200_000 })

  // Model switch updates window without losing current occupancy.
  f.engine.updateSession = async () => ({ effort: null, context: { window: 128_000 } })
  await f.service.updateBot({ botId: 'b1', model: { provider: 'p', model: 'm2' } })
  expect((await f.service.getBot('b1')).context).toEqual({ used: 14_500, window: 128_000 })

  // Starting a new main session resets occupancy to 0 for the new session.
  const fresh = await f.service.newChat('b1', () => {})
  expect(fresh.snapshot.context).toEqual({ used: 0, window: 200_000 })
  expect((await f.service.getBot('b1')).context).toEqual({ used: 0, window: 200_000 })
})

test('persisted bot context survives server restarts without extra engine calls and clears on bot deletion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'bot-context-'))
  const dbPath = join(dir, 'lilbot.db')
  const wsDir = join(dir, 'ws')
  try {
    const start = () => {
      const db = openDatabase(dbPath)
      const store = new BotStore(db)
      if (!store.exists(bot.id)) store.import('test', [{ ...detail, engineId: 'test', engineBotId: nativeBotId }])
      const fake = fakeEngine()
      const service = new BotService(fake.engine, store, new BotPrefsStore(db), new Workspaces(wsDir), new MemoryService(new MemoryStore(db)))
      return { db, fake, service }
    }
    const one = start()
    const chat = await one.service.openChat('b1', undefined, () => {})
    one.fake.emit(chat.snapshot.chatId, {
      type: 'turn.finished',
      status: 'completed',
      text: 'hi',
      usage: { contextTokens: 22_300, contextWindow: 200_000 }
    })
    expect((await one.service.getBot('b1')).context).toEqual({ used: 22_300, window: 200_000 })
    one.db.close()

    // Restart on the same database: bots.list and bots.get immediately return context with zero engine chat calls.
    const two = start()
    expect((await two.service.listBots())[0].context).toEqual({ used: 22_300, window: 200_000 })
    expect((await two.service.getBot('b1')).context).toEqual({ used: 22_300, window: 200_000 })
    expect(two.fake.log).toEqual([])
    await two.service.deleteBot({ botId: 'b1', files: 'delete', privateMemories: 'forget' })
    expect((two.db.query('SELECT count(*) n FROM bot_context WHERE bot_id=?').get('b1') as { n: number }).n).toBe(0)
    two.db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
