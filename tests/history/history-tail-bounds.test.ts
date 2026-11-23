/** Regression tests for LILA-48 delta defects: throwing source.close(), lock leak/deadline, and bounded journal planning. */
import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { prepareSwitchHistory } from '../../server/history/history-switch'
import { DEFAULT_JOURNAL_TAIL_BYTES, DEFAULT_JOURNAL_TAIL_ROWS, planBotJournalTail } from '../../server/history/history-tail-plan'

const idProject = (_b: string, _s: string, r: Parameters<Parameters<typeof planBotJournalTail>[3]>[2]) => r

test('M12: throwing source.close() cannot throw out of dropSource/close or leak switching lock on prepareEngineSwitch', async () => {
  const db = openDatabase(':memory:')
  let listCalls = 0
  const throwingSource: ConversationSource = {
    list: async () => {
      listCalls++
      return [{ id: 's1', at: 100 }]
    },
    read: async () => ({ rows: [], cursor: 'c1', reset: false, empty: true }),
    close: () => {
      throw new Error('close boom')
    }
  }
  const engine = { id: 'e1', conversations: async () => throwingSource } as unknown as BotEngine
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    engine,
    async () => [{ id: 'b1', engineId: 'e1', engineBotId: 'n1' }],
    () => true
  )
  try {
    await history.tick()
    expect(listCalls).toBe(1)

    const sw = await history.prepareEngineSwitch({ id: 'b1', engineId: 'e1', engineBotId: 'n1' })
    sw.release()
    await history.tick()
    expect(listCalls).toBe(3)

    const switching = new Set<string>()
    await expect(
      prepareSwitchHistory(
        {
          store,
          engines: new EngineRegistry([engine]),
          dirty: new Map(),
          inFlight: new Map(),
          switching,
          switchGen: new Map(),
          switchTimers: new Set(),
          allowed: () => true,
          project: idProject,
          changed: () => {},
          dropSource: () => {
            throw new Error('drop boom')
          },
          clearCatchUp: () => {},
          sourceInfo: () => undefined
        },
        { id: 'b1', engineId: 'e1', engineBotId: 'n1' }
      )
    ).rejects.toThrow('drop boom')
    expect(switching.has('b1')).toBe(false)
  } finally {
    expect(() => history.close()).not.toThrow()
    db.close()
  }
})

test('M13: whole-switch lockTimeoutMs releases only the import lock when engine open hangs and leaves sessions unsealed on failure/supersede', async () => {
  const db = openDatabase(':memory:')
  let readCalls = 0
  const source: ConversationSource = {
    list: async () => [{ id: 'old-s1', at: 100 }],
    read: async () => {
      readCalls++
      return { rows: [], cursor: `c${readCalls}`, reset: false, empty: false }
    },
    close: () => {}
  }
  const engine = { id: 'e1', conversations: async () => source } as unknown as BotEngine
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    engine,
    async () => [{ id: 'b1', engineId: 'e1', engineBotId: 'n1' }],
    () => true
  )
  try {
    store.session('b1', 'old-s1', 100)
    const sw = await history.prepareEngineSwitch({ id: 'b1', engineId: 'e1', engineBotId: 'n1' }, { timeoutMs: 20, maxPages: 1, lockTimeoutMs: 40 })
    const readsWhileLocked = readCalls
    await history.tick()
    expect(readCalls).toBe(readsWhileLocked)

    // Timer expires: import lock releases automatically, nothing sealed.
    await Bun.sleep(70)
    expect(store.sessions('b1').find(s => s.id === 'old-s1')?.complete).toBe(0)
    await history.tick()
    expect(readCalls).toBeGreaterThan(readsWhileLocked)

    // Starting a second switch supersedes the expired switch: late commit/release from sw are no-ops and do not release sw2's lock.
    const sw2 = await history.prepareEngineSwitch({ id: 'b1', engineId: 'e1', engineBotId: 'n1' }, { timeoutMs: 20, maxPages: 1, lockTimeoutMs: 500 })
    sw.commit('late-chat')
    expect(store.sessions('b1').some(s => s.id === 'late-chat')).toBe(false)
    expect(store.sessions('b1').find(s => s.id === 'old-s1')?.complete).toBe(0)
    sw.release()
    const beforeBlocked = readCalls
    await history.tick()
    expect(readCalls).toBe(beforeBlocked)
    sw2.release()
  } finally {
    history.close()
    db.close()
  }
})

test('M14: planBotJournalTail skips complete non-dirty sessions, includes dirty complete sessions, and bounds rows/bytes on huge tails', async () => {
  const db = openDatabase(':memory:')
  const store = new HistoryStore(db)
  const insert = db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)')
  const seedTurns = (bot: string, sid: string, prefix: string, startAt: number, count: number) => {
    for (let i = 0; i < count; i++) {
      const t = startAt + i * 10
      insert.run(bot, sid, t, JSON.stringify({ type: 'user.message', messageId: `${prefix}u-${i}`, text: `${prefix}-u-${i}`, attachments: [] }), `${prefix}u-${i}`)
      insert.run(bot, sid, t + 1, JSON.stringify({ type: 'turn.started' }), `${prefix}s-${i}`)
      for (let d = 0; d < 4; d++) insert.run(bot, sid, t + 2 + d, JSON.stringify({ type: 'text.delta', text: 'chunk-' }), `${prefix}d-${i}-${d}`)
      insert.run(bot, sid, t + 6, JSON.stringify({ type: 'turn.finished', status: 'completed', text: `${prefix}-a-${i}` }), `${prefix}a-${i}`)
    }
  }
  try {
    store.session('b1', 's-done', 100)
    store.write('b1', 's-done', [{ id: 'done-1', at: 101, order: 0, item: { kind: 'user', text: 'already imported' } }], 'c1', true)
    db.transaction(() => {
      for (let i = 0; i < 40; i++)
        insert.run('b1', 's-done', 200 + i, JSON.stringify({ type: 'user.message', messageId: `d-${i}`, text: `stale ${i}`, attachments: [] }), `dk-${i}`)
    })()

    store.session('b1', 's-dirty', 300)
    store.write('b1', 's-dirty', [], 'c0', true)
    insert.run('b1', 's-dirty', 310, JSON.stringify({ type: 'user.message', messageId: 'dm1', text: 'dirty turn', attachments: [] }), 'dir-1')
    insert.run('b1', 's-dirty', 311, JSON.stringify({ type: 'turn.finished', status: 'completed', text: 'dirty ans' }), 'dir-2')

    const dirtyPlan = planBotJournalTail(store, 'b1', () => true, idProject, new Set(['s-dirty']))
    expect(dirtyPlan.truncated).toBe(false)
    expect(dirtyPlan.entries.map(e => e.session)).toEqual(['s-dirty'])
    expect(dirtyPlan.entries[0].rows.map(r => ('text' in r.item ? r.item.text : ''))).toEqual(['dirty turn', 'dirty ans'])

    store.session('b2', 's-old', 1000)
    store.session('b2', 's-new', 50_000)
    db.transaction(() => {
      seedTurns('b2', 's-old', 'old', 1000, 1000)
      seedTurns('b2', 's-new', 'new', 50_000, 1000)
    })()

    const defaultPlan = planBotJournalTail(store, 'b2', () => true, idProject)
    expect(defaultPlan.truncated).toBe(true)
    expect(defaultPlan.totalRows).toBe(DEFAULT_JOURNAL_TAIL_ROWS)
    expect(defaultPlan.totalBytes).toBeLessThanOrEqual(DEFAULT_JOURNAL_TAIL_BYTES)
    expect(defaultPlan.entries.map(e => e.session)).toEqual(['s-new'])
    const texts = defaultPlan.entries[0].rows.map(r => ('text' in r.item ? r.item.text : ''))
    expect(texts[0]).toBe('new-u-900')
    expect(texts.at(-1)).toBe('new-a-999')

    store.session('b3', 's-big', 100)
    db.transaction(() => {
      for (let i = 0; i < 20; i++)
        insert.run('b3', 's-big', 100 + i, JSON.stringify({ type: 'user.message', messageId: `bm-${i}`, text: `msg-${i}:${'x'.repeat(600)}`, attachments: [] }), `bk-${i}`)
    })()
    const downEngine = { id: 'down', conversations: async () => Promise.reject(new Error('offline')) } as unknown as BotEngine
    const history = new HistoryService(
      store,
      downEngine,
      async () => [],
      () => true
    )
    try {
      const sw = await history.prepareEngineSwitch({ id: 'b3', engineId: 'down', engineBotId: 'n3' }, { maxJournalRows: 100, maxJournalBytes: 2_500 })
      sw.commit('s-next')
      const page = store.page('b3', undefined, 50, 's-next')
      const kept = page.items.filter(r => r.item.kind === 'user').map(r => (r.item.kind === 'user' ? r.item.text.slice(0, 6) : ''))
      expect(kept.length).toBeGreaterThanOrEqual(2)
      expect(kept.length).toBeLessThan(20)
      expect(kept.at(-1)).toBe('msg-19')
      expect(page.items.some(r => r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(true)
    } finally {
      history.close()
    }
  } finally {
    db.close()
  }
})
