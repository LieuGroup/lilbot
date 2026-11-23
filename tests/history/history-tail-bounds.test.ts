/** Regression tests for LILA-48 delta defects: throwing source.close(), lock leak/deadline, and bounded journal planning. */
import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { prepareSwitchHistory } from '../../server/history/history-switch'
import { DEFAULT_JOURNAL_TAIL_BYTES, DEFAULT_JOURNAL_TAIL_ROWS, planBotJournalTail } from '../../server/history/history-tail-plan'

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
    // Source was evicted even though close() threw, so next tick reconnects cleanly and is not wedged by switching lock.
    await history.tick()
    expect(listCalls).toBe(3)

    // Direct throw inside prepareSwitchHistory before handoff also releases switching.
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
          project: (_b, _s, r) => r,
          changed: () => {},
          dropSource: () => {
            throw new Error('drop boom')
          },
          clearCatchUp: () => {}
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

test('M13: whole-switch lockTimeoutMs releases lock when engine open hangs, leaves sessions unsealed, and makes late commit a no-op', async () => {
  const db = openDatabase(':memory:')
  let readCalls = 0
  const source: ConversationSource = {
    list: async () => [{ id: 'old-s1', at: 100 }],
    read: async () => {
      readCalls++
      return { rows: [], cursor: 'c1', reset: false, empty: false }
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

    // Simulate hung openChat exceeding lockTimeoutMs -> lock releases automatically, nothing sealed.
    await Bun.sleep(70)
    expect(store.sessions('b1').find(s => s.id === 'old-s1')?.complete).toBe(0)
    await history.tick()
    expect(readCalls).toBeGreaterThan(readsWhileLocked)

    // Late commit after deadline is a no-op: writes no divider, seals nothing, opens no new session.
    sw.commit('late-chat')
    expect(store.sessions('b1').some(s => s.id === 'late-chat')).toBe(false)
    expect(store.sessions('b1').find(s => s.id === 'old-s1')?.complete).toBe(0)

    // Starting a second switch and calling late release() on the expired switch never clears the new lock.
    const sw2 = await history.prepareEngineSwitch({ id: 'b1', engineId: 'e1', engineBotId: 'n1' }, { timeoutMs: 20, maxPages: 1, lockTimeoutMs: 500 })
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

test('M14: planBotJournalTail skips complete non-dirty sessions, includes dirty complete sessions, and bounds rows/bytes + RAM on huge tails', async () => {
  const db = openDatabase(':memory:')
  const store = new HistoryStore(db)
  const insert = db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)')
  try {
    // 1. Complete, non-dirty old session with historical events -> must be skipped completely.
    store.session('b1', 's-done', 100)
    store.write('b1', 's-done', [{ id: 'done-1', at: 101, order: 0, item: { kind: 'user', text: 'already imported' } }], 'c1', true)
    db.transaction(() => {
      for (let i = 0; i < 40; i++) {
        insert.run('b1', 's-done', 200 + i, JSON.stringify({ type: 'user.message', messageId: `d-${i}`, text: `stale ${i}`, attachments: [] }), `dk-${i}`)
      }
    })()

    // 2. Complete session that IS dirty (new turn arrived) -> must still be planned.
    store.session('b1', 's-dirty', 300)
    store.write('b1', 's-dirty', [], 'c0', true)
    insert.run('b1', 's-dirty', 310, JSON.stringify({ type: 'user.message', messageId: 'dm1', text: 'dirty turn', attachments: [] }), 'dir-1')
    insert.run('b1', 's-dirty', 311, JSON.stringify({ type: 'turn.finished', status: 'completed', text: 'dirty ans' }), 'dir-2')

    const dirtyPlan = planBotJournalTail(
      store,
      'b1',
      () => true,
      (_b, _s, r) => r,
      new Set(['s-dirty'])
    )
    expect(dirtyPlan.truncated).toBe(false)
    expect(dirtyPlan.entries.map(e => e.session)).toEqual(['s-dirty'])
    expect(dirtyPlan.entries[0].rows.map(r => ('text' in r.item ? r.item.text : ''))).toEqual(['dirty turn', 'dirty ans'])

    // 3. Large unimported tail (2,000 turns + 8,000 text.delta chunks across two incomplete sessions) -> bounded rows, bytes, and heap.
    store.session('b2', 's-old', 1000)
    store.session('b2', 's-new', 50_000)
    db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        const t = 1000 + i * 10
        insert.run('b2', 's-old', t, JSON.stringify({ type: 'user.message', messageId: `ou-${i}`, text: `old-u-${i}`, attachments: [] }), `ou-${i}`)
        insert.run('b2', 's-old', t + 1, JSON.stringify({ type: 'turn.started' }), `os-${i}`)
        for (let d = 0; d < 4; d++) insert.run('b2', 's-old', t + 2 + d, JSON.stringify({ type: 'text.delta', text: 'chunk-' }), `od-${i}-${d}`)
        insert.run('b2', 's-old', t + 6, JSON.stringify({ type: 'turn.finished', status: 'completed', text: `old-a-${i}` }), `oa-${i}`)
      }
      for (let i = 0; i < 1000; i++) {
        const t = 50_000 + i * 10
        insert.run('b2', 's-new', t, JSON.stringify({ type: 'user.message', messageId: `nu-${i}`, text: `new-u-${i}`, attachments: [] }), `nu-${i}`)
        insert.run('b2', 's-new', t + 1, JSON.stringify({ type: 'turn.started' }), `ns-${i}`)
        for (let d = 0; d < 4; d++) insert.run('b2', 's-new', t + 2 + d, JSON.stringify({ type: 'text.delta', text: 'chunk-' }), `nd-${i}-${d}`)
        insert.run('b2', 's-new', t + 6, JSON.stringify({ type: 'turn.finished', status: 'completed', text: `new-a-${i}` }), `na-${i}`)
      }
    })()

    const defaultPlan = planBotJournalTail(
      store,
      'b2',
      () => true,
      (_b, _s, r) => r
    )
    expect(defaultPlan.truncated).toBe(true)
    expect(defaultPlan.totalRows).toBe(DEFAULT_JOURNAL_TAIL_ROWS)
    expect(defaultPlan.totalBytes).toBeLessThanOrEqual(DEFAULT_JOURNAL_TAIL_BYTES)
    expect(defaultPlan.entries.map(e => e.session)).toEqual(['s-new'])
    const texts = defaultPlan.entries[0].rows.map(r => ('text' in r.item ? r.item.text : ''))
    expect(texts[0]).toBe('new-u-900')
    expect(texts.at(-1)).toBe('new-a-999')

    // 4. Byte cap truncation writes engine_switched_gap on committed switch and keeps newest rows in order.
    store.session('b3', 's-big', 100)
    db.transaction(() => {
      for (let i = 0; i < 20; i++) {
        insert.run('b3', 's-big', 100 + i, JSON.stringify({ type: 'user.message', messageId: `bm-${i}`, text: `msg-${i}:${'x'.repeat(600)}`, attachments: [] }), `bk-${i}`)
      }
    })()
    const downEngine = {
      id: 'down',
      conversations: async () => {
        throw new Error('offline')
      }
    } as unknown as BotEngine
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
