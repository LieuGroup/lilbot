/** Regression tests for post-deadline engine switch commits: slow success, stale-plan re-plan, slow failure, and superseding switches. */
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
const defer = () => {
  let resolve!: () => void
  const promise = new Promise<void>(r => {
    resolve = r
  })
  return { promise, resolve }
}
const texts = (items: { item: { kind: string; text?: string } }[], kind: string) => items.filter(r => r.item.kind === kind).map(r => r.item.text ?? '')

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-hdead-'))
  dirs.push(root)
  const db = openDatabase(join(root, 'lilbot.db'))
  const [engineA, engineB] = [new ScriptedEngine({ id: 'eng-a' }), new ScriptedEngine({ id: 'eng-b' })]
  const registry = new EngineRegistry([engineA, engineB])
  const store = new BotStore(db)
  const memory = { list: () => [], forgetPrivate: () => {}, contextBlock: () => '', write: () => {} } as any
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

test('slow-but-successful switch after lockTimeoutMs seals old sessions, writes divider, keeps tail once, and lets target import finish', async () => {
  const f = fixture()
  try {
    f.engineA.setTurnHandler(async ctx => `ans:${ctx.input.text}`)
    const bot = await f.bots.createBot({ name: 'SlowWin', function: '', instructions: '' }, undefined, 'eng-a')
    const chat = await f.bots.openChat(bot.id, undefined, () => {})
    const oldSessionId = chat.snapshot.chatId
    await chat.send('unimported-before-slow-switch')
    chat.close()

    f.engineA.conversations = async () => Promise.reject(new Error('old engine down'))
    const origPrepare = f.history.prepareEngineSwitch
    f.history.prepareEngineSwitch = (prev, opts) => origPrepare(prev, { ...opts, timeoutMs: 40, lockTimeoutMs: 30 })

    const [entered, finishOpen] = [defer(), defer()]
    const origOpen = f.engineB.openChat.bind(f.engineB)
    f.engineB.openChat = async (...args) => {
      entered.resolve()
      await finishOpen.promise
      return origOpen(...args)
    }

    const switching = f.bots.switchEngine(bot.id, 'eng-b')
    await entered.promise
    await Bun.sleep(60)
    await f.history.tick()
    expect(f.historyStore.sessions(bot.id).find(s => s.id === oldSessionId)?.complete).toBe(0)

    finishOpen.resolve()
    const res = await switching
    expect(res.changed).toBe(true)

    const sessions = f.historyStore.sessions(bot.id)
    expect(sessions.find(s => s.id === oldSessionId)?.complete).toBe(1)
    expect(sessions.find(s => s.id === res.chatId)?.complete).toBe(0)
    const page = await f.bots.historyPage(bot.id)
    expect(texts(page.items, 'user')).toEqual(['unimported-before-slow-switch'])
    expect(texts(page.items, 'assistant')).toEqual(['ans:unimported-before-slow-switch'])
    expect(page.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(true)

    await f.history.tick()
    expect(f.historyStore.progress(bot.id).complete).toBe(true)
  } finally {
    f.history.close()
    f.db.close()
  }
})

test('post-expiry commit re-plans idempotently when importer ran in between and discards in-flight reads via bumped switchGen', async () => {
  const db = openDatabase(':memory:')
  let [offline, readNum] = [true, 0]
  const [lateStarted, releaseLateRead] = [defer(), defer()]
  const source: ConversationSource = {
    list: async () => [{ id: 'old-s1', at: 100 }],
    read: async () => {
      if (++readNum === 1) {
        return {
          rows: [
            { id: 'c1', at: 101, order: 0, item: { kind: 'user', text: 'same' } },
            { id: 'c2', at: 102, order: 1, item: { kind: 'assistant', text: 'ans1' } }
          ],
          cursor: 'p1',
          reset: false,
          empty: false
        }
      }
      lateStarted.resolve()
      await releaseLateRead.promise
      return { rows: [{ id: 'stale-late', at: 103, order: 2, item: { kind: 'user', text: 'stale' } }], cursor: 'p2', reset: false, empty: false }
    },
    close: () => {}
  }
  const engine = { id: 'eng-a', conversations: async () => (offline ? Promise.reject(new Error('offline')) : source) } as unknown as BotEngine
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    engine,
    async () => [{ id: 'b1', engineId: 'eng-a', engineBotId: 'n1' }],
    () => true
  )
  try {
    store.session('b1', 'old-s1', 100)
    const imgs = { support: 'unknown' as const, imageCount: 0 }
    store.event('b1', 'old-s1', { type: 'user.message', messageId: 'm1', text: 'same', attachments: [], images: imgs }, 'k1')
    store.event('b1', 'old-s1', { type: 'turn.finished', status: 'completed', text: 'ans1', rowId: 'c2' }, 'k2')
    store.event('b1', 'old-s1', { type: 'user.message', messageId: 'm2', text: 'same', attachments: [], images: imgs }, 'k3')
    store.event('b1', 'old-s1', { type: 'turn.finished', status: 'completed', text: 'ans2', rowId: 'c4' }, 'k4')
    const sw = await history.prepareEngineSwitch({ id: 'b1', engineId: 'eng-a', engineBotId: 'n1' }, { timeoutMs: 20, lockTimeoutMs: 30 })
    await Bun.sleep(60)
    offline = false
    await history.tick()
    const inflightTick = history.tick()
    await lateStarted.promise
    sw.commit('new-s1')
    releaseLateRead.resolve()
    await inflightTick
    expect(store.sessions('b1').find(s => s.id === 'old-s1')?.complete).toBe(1)
    expect(store.sessions('b1').find(s => s.id === 'new-s1')?.complete).toBe(0)
    const items = store.page('b1', undefined, 50, 'new-s1').items
    expect(texts(items, 'user')).toEqual(['same', 'same'])
    expect(texts(items, 'assistant')).toEqual(['ans1', 'ans2'])
    expect(items.some(r => r.id === 'stale-late')).toBe(false)
    expect(items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(true)
  } finally {
    history.close()
    db.close()
  }
})

test('slow-then-failed switch and superseded first switch after expiry seal nothing and write no divider', async () => {
  const f = fixture()
  try {
    f.engineA.setTurnHandler(async ctx => `reply:${ctx.input.text}`)
    const bot = await f.bots.createBot({ name: 'SlowFail', function: '', instructions: '' }, undefined, 'eng-a')
    const chat = await f.bots.openChat(bot.id, undefined, () => {})
    const oldSessionId = chat.snapshot.chatId
    await chat.send('keep-unsealed')
    chat.close()

    const origPrepare = f.history.prepareEngineSwitch
    f.history.prepareEngineSwitch = (prev, opts) => origPrepare(prev, { ...opts, timeoutMs: 40, maxPages: 1, lockTimeoutMs: 25 })
    f.engineA.conversations = async () => Promise.reject(new Error('old offline'))
    const origOpen = f.engineB.openChat.bind(f.engineB)
    f.engineB.openChat = async () => {
      await Bun.sleep(60)
      throw new Error('target open failed')
    }
    await expect(f.bots.switchEngine(bot.id, 'eng-b')).rejects.toThrow('target open failed')
    expect(f.historyStore.sessions(bot.id).find(s => s.id === oldSessionId)?.complete).toBe(0)
    expect((await f.bots.historyPage(bot.id)).items.some(r => r.item.kind === 'session')).toBe(false)

    f.engineB.openChat = origOpen
    const sw1 = await origPrepare({ id: bot.id, engineId: 'eng-a', engineBotId: f.store.get(bot.id).engineBotId }, { timeoutMs: 20, lockTimeoutMs: 25 })
    await Bun.sleep(50)
    const sw2 = await origPrepare({ id: bot.id, engineId: 'eng-a', engineBotId: f.store.get(bot.id).engineBotId }, { timeoutMs: 20, lockTimeoutMs: 500 })
    sw2.commit('winner-chat')
    sw1.commit('loser-chat')
    sw1.release()
    const sessions = f.historyStore.sessions(bot.id)
    expect(sessions.find(s => s.id === oldSessionId)?.complete).toBe(1)
    expect(sessions.find(s => s.id === 'winner-chat')?.complete).toBe(0)
    expect(sessions.some(s => s.id === 'loser-chat')).toBe(false)
    const dividers = f.historyStore.page(bot.id, undefined, 50, 'winner-chat').items.filter(r => r.item.kind === 'session')
    expect(dividers.map(d => d.sessionId)).toEqual(['winner-chat'])
  } finally {
    f.history.close()
    f.db.close()
  }
})
