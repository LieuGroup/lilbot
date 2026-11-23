/** Pre-switch bounded flush, unreachable/hanging engine journal fallback, compaction recovery, and clean-vs-gap divider. */
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
  const memory = {
    list: () => [],
    forgetPrivate: () => {},
    contextBlock: () => '',
    write: () => {
      throw new Error('unused')
    }
  } as any
  const historyStore = new HistoryStore(db)
  const history = new HistoryService(
    historyStore,
    registry,
    async () => store.list().filter(b => registry.has(b.engineId)),
    () => true
  )
  const bots = new BotService(registry, store, new BotPrefsStore(db), new Workspaces(join(root, 'ws')), memory, { history })
  return { db, engineA, engineB, store, historyStore, history, bots }
}

test('switchEngine flushes unimported tail before deleting old runtime and writes clean engine_switched divider', async () => {
  const f = fixture()
  try {
    f.engineA.setTurnHandler(async ctx => `reply:${ctx.input.text}`)
    const bot = await f.bots.createBot({ name: 'Alpha', function: '', instructions: '' }, undefined, 'scripted-a')
    const oldChat = await f.engineA.openChat(f.store.get(bot.id).engineBotId, null, { workspace: '/tmp' }, () => {})
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

    await f.history.tick()
    expect(f.historyStore.progress(bot.id).complete).toBe(true)
  } finally {
    f.history.close()
    f.db.close()
  }
})

test('unreachable old engine reconciles tail + compaction (PROBE_1C) with gap divider (M7); already-complete bot stays clean (PROBE_1D)', async () => {
  const f = fixture()
  try {
    f.engineA.setTurnHandler(async ctx => `ans:${ctx.input.text}`)
    const bot = await f.bots.createBot({ name: 'Mover', function: '', instructions: '' }, undefined, 'scripted-a')
    const cleanBot = await f.bots.createBot({ name: 'Clean', function: '', instructions: '' }, undefined, 'scripted-a')
    const chat = await f.bots.openChat(bot.id, undefined, () => {})
    await chat.send('same')
    const cleanChat = await f.bots.openChat(cleanBot.id, undefined, () => {})
    await cleanChat.send('all imported')
    cleanChat.close()
    await f.history.tick()
    await f.history.tick()
    expect(f.historyStore.progress(cleanBot.id).complete).toBe(true)

    f.engineA.conversations = async () => {
      throw new Error('engine unreachable')
    }
    // PROBE_1D: already 100% imported with zero dirty/unimported events -> clean engine_switched divider.
    await f.bots.switchEngine(cleanBot.id, 'scripted-b')
    const cleanPage = await f.bots.historyPage(cleanBot.id)
    expect(cleanPage.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched')).toBe(true)
    expect(cleanPage.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(false)

    // PROBE_1C + repeated text while engineA is unreachable.
    await chat.send('same')
    f.history.record(
      bot.id,
      chat.snapshot.chatId,
      { type: 'user.message', messageId: 'mc1', text: 'compacted prompt', attachments: [], images: { support: 'unknown', imageCount: 0 } },
      'kc1'
    )
    f.history.record(
      bot.id,
      chat.snapshot.chatId,
      { type: 'turn.finished', status: 'completed', text: 'after compact', rowId: 'eng:after-c', compacted: { beforeTokens: 120_000, afterTokens: 24_000 } },
      'kc2'
    )
    chat.close()

    await f.bots.switchEngine(bot.id, 'scripted-b')
    const page = await f.bots.historyPage(bot.id)
    expect(page.items.filter(r => r.item.kind === 'user').map(r => (r.item.kind === 'user' ? r.item.text : ''))).toEqual(['same', 'same', 'compacted prompt'])
    expect(page.items.filter(r => r.item.kind === 'assistant').map(r => (r.item.kind === 'assistant' ? r.item.text : ''))).toEqual(['ans:same', 'ans:same', 'after compact'])
    expect(page.items.filter(r => r.item.kind === 'compaction').map(r => r.item)).toEqual([{ kind: 'compaction', beforeTokens: 120_000, afterTokens: 24_000 }])
    expect(page.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(true)

    // M7: gap divider stays visible even if Oscar starts another new session without speaking.
    const next = await f.bots.newChat(bot.id, () => {})
    next.close()
    expect((await f.bots.historyPage(bot.id)).items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(true)
  } finally {
    f.history.close()
    f.db.close()
  }
})

test('hanging old engine is bounded by flush timeout, closes late source cleanly, and reconciles only on commit', async () => {
  const db = openDatabase(':memory:')
  let closedLate = false
  let resolveHang!: (s: ConversationSource) => void
  const hangingEngine = {
    id: 'hang',
    conversations: () =>
      new Promise<ConversationSource>(r => {
        resolveHang = r
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
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'journal reply', rowId: 'eng:j1' }, 'k2')

    const t0 = performance.now()
    const prepared = await history.prepareEngineSwitch({ id: 'b1', engineId: 'hang', engineBotId: 'n1' }, { timeoutMs: 80 })
    expect(performance.now() - t0).toBeLessThan(500)
    expect(store.page('b1').items).toEqual([])
    prepared.commit('s2')

    resolveHang({
      list: async () => [],
      read: async () => ({ rows: [], cursor: null, reset: false, empty: true }),
      close: () => {
        closedLate = true
      }
    })
    await Bun.sleep(10)
    expect(closedLate).toBe(true)
    const items = store.page('b1').items
    expect(items.filter(r => r.item.kind !== 'session').map(r => ('text' in r.item ? r.item.text : ''))).toEqual(['kept via journal', 'journal reply'])
    expect(items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(true)
  } finally {
    history.close()
    db.close()
  }
})
