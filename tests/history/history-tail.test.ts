/** Pre-switch bounded flush, unreachable-engine journal reconciliation, gap divider, and non-blocking post-turn catch-up. */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-htail-'))
  dirs.push(root)
  const db = openDatabase(join(root, 'lilbot.db'))
  const [engineA, engineB] = [new ScriptedEngine({ id: 'scripted-a' }), new ScriptedEngine({ id: 'scripted-b' })]
  const registry = new EngineRegistry([engineA, engineB])
  const store = new BotStore(db)
  const prefs = new BotPrefsStore(db)
  const memory = {
    list: () => [],
    forgetPrivate: () => {},
    contextBlock: () => '',
    write: () => {
      throw new Error('unused')
    }
  } as any
  const historyStore = new HistoryStore(db)
  const hidden = new Set<string>()
  const history = new HistoryService(
    historyStore,
    registry,
    async () => store.list().filter(b => registry.has(b.engineId)),
    (_bot, session) => !hidden.has(session)
  )
  const bots = new BotService(registry, store, prefs, new Workspaces(join(root, 'ws')), memory, { history })
  return { db, engineA, engineB, registry, store, prefs, historyStore, history, bots, hidden }
}

test('switchEngine flushes unimported tail before deleting old runtime and writes clean engine_switched divider', async () => {
  const f = fixture()
  try {
    f.engineA.setTurnHandler(async ctx => `reply:${ctx.input.text}`)
    const bot = await f.bots.createBot({ name: 'Alpha', function: '', instructions: '' }, undefined, 'scripted-a')
    // Seed an older session directly on engineA without running tick() so both sessions are unimported.
    const nativeId = f.store.get(bot.id).engineBotId
    const oldChat = await f.engineA.openChat(nativeId, null, { workspace: '/tmp' }, () => {})
    await oldChat.send('earlier offline turn')
    oldChat.close()

    const live = await f.bots.openChat(bot.id, undefined, () => {})
    await live.send('latest live turn')
    live.close()

    const switched = await f.bots.switchEngine(bot.id, 'scripted-b', { deleteOldRuntime: true })
    expect(switched.changed).toBe(true)

    const page = await f.bots.historyPage(bot.id)
    const texts = page.items.map(r => ('text' in r.item ? r.item.text : ''))
    expect(texts).toContain('earlier offline turn')
    expect(texts).toContain('reply:earlier offline turn')
    expect(texts).toContain('latest live turn')
    expect(texts).toContain('reply:latest live turn')
    expect(page.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched')).toBe(true)
    expect(page.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(false)

    // Subsequent tick on engineB never polls or fails on engineA's sealed sessions.
    await f.history.tick()
    expect(f.historyStore.progress(bot.id).complete).toBe(true)
  } finally {
    f.history.close()
    f.db.close()
  }
})

test('unreachable old engine never blocks switchEngine, reconciles tail from journal without duplicating repeated text, and shows gap divider', async () => {
  const f = fixture()
  try {
    f.engineA.setTurnHandler(async ctx => `ans:${ctx.input.text}`)
    const bot = await f.bots.createBot({ name: 'Mover', function: '', instructions: '' }, undefined, 'scripted-a')
    const chat = await f.bots.openChat(bot.id, undefined, () => {})
    await chat.send('same')
    await f.history.tick()
    await f.history.tick()
    // Now make engineA unreachable before sending a second turn with identical text + a distinct third turn.
    f.engineA.conversations = async () => {
      throw new Error('engine unreachable')
    }
    await chat.send('same')
    await chat.send('unimported tail')
    chat.close()

    const switched = await f.bots.switchEngine(bot.id, 'scripted-b')
    expect(switched.changed).toBe(true)

    const page = await f.bots.historyPage(bot.id)
    const userTexts = page.items.filter(r => r.item.kind === 'user').map(r => (r.item.kind === 'user' ? r.item.text : ''))
    const botTexts = page.items.filter(r => r.item.kind === 'assistant').map(r => (r.item.kind === 'assistant' ? r.item.text : ''))
    expect(userTexts).toEqual(['same', 'same', 'unimported tail'])
    expect(botTexts).toEqual(['ans:same', 'ans:same', 'ans:unimported tail'])
    expect(page.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(true)

    // Gap divider remains visible even if Oscar immediately starts another new session without speaking.
    const next = await f.bots.newChat(bot.id, () => {})
    next.close()
    const afterNew = await f.bots.historyPage(bot.id)
    expect(afterNew.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(true)
  } finally {
    f.history.close()
    f.db.close()
  }
})

test('hanging old engine is bounded by flush timeout, closes late source cleanly, and reconciles from journal', async () => {
  const db = openDatabase(':memory:')
  let closedLate = false
  let resolveHang!: (s: ConversationSource) => void
  const hangingEngine = {
    id: 'hang',
    conversations: () =>
      new Promise<ConversationSource>(resolve => {
        resolveHang = resolve
      })
  } as unknown as BotEngine
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    hangingEngine,
    async () => [],
    () => true
  )
  try {
    store.event('b1', 's1', { type: 'user.message', messageId: 'm1', text: 'kept via journal', attachments: [], images: { support: 'unknown', imageCount: 0 } }, 'k1')
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'journal reply' }, 'k2')

    const t0 = performance.now()
    const res = await history.flush({ id: 'b1', engineId: 'hang', engineBotId: 'n1' }, { timeoutMs: 80 })
    const elapsed = performance.now() - t0
    expect(res.incomplete).toBe(true)
    expect(res.reconciled).toBe(2)
    expect(elapsed).toBeLessThan(500)

    // Late-resolving source is closed automatically instead of leaking.
    resolveHang({
      list: async () => [],
      read: async () => ({ rows: [], cursor: null, reset: false, empty: true }),
      close: () => {
        closedLate = true
      }
    })
    await Bun.sleep(10)
    expect(closedLate).toBe(true)
    expect(store.page('b1').items.map(r => ('text' in r.item ? r.item.text : ''))).toEqual(['kept via journal', 'journal reply'])
  } finally {
    history.close()
    db.close()
  }
})

test('completed turn triggers non-blocking catch-up without calling tick()', async () => {
  const f = fixture()
  try {
    f.engineA.setTurnHandler(async () => 'fast catch-up')
    const bot = await f.bots.createBot({ name: 'Fast', function: '', instructions: '' }, undefined, 'scripted-a')
    const chat = await f.bots.openChat(bot.id, undefined, () => {})
    await chat.send('ping')
    chat.close()

    for (let i = 0; i < 40; i++) {
      const page = await f.bots.historyPage(bot.id)
      if (page.items.some(r => r.item.kind === 'assistant' && r.item.text === 'fast catch-up')) break
      await Bun.sleep(15)
    }
    const page = await f.bots.historyPage(bot.id)
    expect(page.items.some(r => r.item.kind === 'user' && r.item.text === 'ping')).toBe(true)
    expect(page.items.some(r => r.item.kind === 'assistant' && r.item.text === 'fast catch-up')).toBe(true)
  } finally {
    f.history.close()
    f.db.close()
  }
})
