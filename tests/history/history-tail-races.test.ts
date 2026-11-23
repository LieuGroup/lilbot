/** Regression tests for LILA-48 Probes B & C and mutations M8-M10: catch-up dirty race, switch/tick unseal race, and gap divider sync. */
import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'

test('PROBE_B_CATCHUP_RACE: a second turn finishing while catch-up read is in flight is not dropped', async () => {
  const db = openDatabase(':memory:')
  const rows = [
    { id: 'r1', at: 10, order: 0, item: { kind: 'user' as const, text: 'turn 1' } },
    { id: 'r2', at: 11, order: 1, item: { kind: 'assistant' as const, text: 'reply 1' } }
  ]
  let readCount = 0
  let releaseSecondRead!: () => void
  const secondReadStarted = new Promise<void>(resolve => {
    releaseSecondRead = resolve
  })
  let resumeSecondRead!: () => void
  const source: ConversationSource = {
    list: async () => [{ id: 's1', at: 10 }],
    read: async (_id, cursor) => {
      readCount++
      const start = Number(cursor ?? 0)
      if (readCount === 2) {
        releaseSecondRead()
        await new Promise<void>(resolve => {
          resumeSecondRead = resolve
        })
        return { rows: [], cursor: String(start), reset: false, empty: true }
      }
      const slice = rows.slice(start, start + 100)
      return { rows: slice, cursor: String(start + slice.length), reset: false, empty: slice.length === 0 }
    },
    close: () => {}
  }
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    { id: 'e1', conversations: async () => source } as unknown as BotEngine,
    async () => [{ id: 'b1', engineId: 'e1', engineBotId: 'n1' }],
    () => true
  )
  try {
    history.record('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'reply 1' }, 't1')
    await secondReadStarted
    rows.push({ id: 'r3', at: 20, order: 2, item: { kind: 'user', text: 'turn 2' } }, { id: 'r4', at: 21, order: 3, item: { kind: 'assistant', text: 'reply 2' } })
    history.record('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'reply 2' }, 't2')
    resumeSecondRead()

    for (let i = 0; i < 40; i++) {
      if (store.page('b1').items.some(r => r.id === 'r4')) break
      await Bun.sleep(15)
    }
    expect(store.page('b1').items.map(r => r.id)).toEqual(['r1', 'r2', 'r3', 'r4'])
  } finally {
    history.close()
    db.close()
  }
})

test('PROBE_C_UNSEAL_RACE + M8/M9/M10: switching lock blocks mid-switch ticks, discards late unsealing reads, seals old sessions, and keeps first-session gap divider', async () => {
  const db = openDatabase(':memory:')
  let releaseOldRead!: () => void
  let oldReadStarted!: () => void
  const readStarted = new Promise<void>(r => {
    oldReadStarted = r
  })
  const oldSource: ConversationSource = {
    list: async () => [{ id: 'old-s1', at: 100 }],
    read: async () => {
      oldReadStarted()
      await new Promise<void>(r => {
        releaseOldRead = r
      })
      return { rows: [{ id: 'stale-row', at: 101, order: 0, item: { kind: 'user', text: 'stale' } }], cursor: 'c1', reset: false, empty: false }
    },
    close: () => {}
  }
  const newReads: string[] = []
  const newSource: ConversationSource = {
    list: async () => [{ id: 'new-s1', at: 500 }],
    read: async id => {
      newReads.push(id)
      return { rows: [], cursor: 'done', reset: false, empty: true }
    },
    close: () => {}
  }
  const engA = { id: 'eng-a', conversations: async () => oldSource } as unknown as BotEngine
  const engB = { id: 'eng-b', conversations: async () => newSource } as unknown as BotEngine
  let activeEngine = 'eng-a'
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    new EngineRegistry([engA, engB]),
    async () => [{ id: 'b1', engineId: activeEngine, engineBotId: 'n1' }],
    () => true
  )
  try {
    store.session('b1', 'old-s1', 100)
    const inflightTick = history.tick()
    await readStarted

    const prepared = await history.prepareEngineSwitch({ id: 'b1', engineId: 'eng-a', engineBotId: 'n1' }, { timeoutMs: 60 })
    prepared.commit('new-s1')
    expect(store.sessions('b1').find(s => s.id === 'old-s1')?.complete).toBe(1)

    // PROBE_C + M10b: late oldSource.read() resolves with empty: false -> must NOT unseal old-s1 or write stale-row.
    releaseOldRead()
    await inflightTick
    expect(store.sessions('b1').find(s => s.id === 'old-s1')?.complete).toBe(1)
    expect(store.page('b1').items.some(r => r.id === 'stale-row')).toBe(false)

    // M8: tick() on eng-b reaches complete=true and never polls old-s1.
    activeEngine = 'eng-b'
    await history.tick()
    await history.tick()
    expect(store.progress('b1').complete).toBe(true)
    expect(newReads).not.toContain('old-s1')

    // M10a + M9: with no other tick running (busy=false), switching lock blocks tick() before commit(), and
    // zero-prior-session unreachable switch preserves engine_switched_gap on sessions[0] across tick().
    const b2Reads: string[] = []
    const engB2 = {
      id: 'eng-b2',
      conversations: async () => ({
        list: async () => [{ id: 'first-s1', at: Date.now() }],
        read: async (id: string) => {
          b2Reads.push(id)
          return { rows: [], cursor: 'done', reset: false, empty: true }
        },
        close: () => {}
      })
    } as unknown as BotEngine
    const engDown = {
      id: 'eng-down',
      conversations: async () => {
        throw new Error('down')
      }
    } as unknown as BotEngine
    const history2 = new HistoryService(
      store,
      new EngineRegistry([engDown, engB2]),
      async () => [{ id: 'b2', engineId: 'eng-b2', engineBotId: 'n2' }],
      () => true
    )
    try {
      const sw2 = await history2.prepareEngineSwitch({ id: 'b2', engineId: 'eng-down', engineBotId: 'n2' })
      await history2.tick()
      expect(b2Reads).toEqual([])
      sw2.commit('first-s1')
      await history2.tick()
      expect(b2Reads).toEqual(['first-s1'])
      expect(store.page('b2', undefined, 50, 'first-s1').items.some(r => r.id === 'session:first-s1' && r.item.kind === 'session' && r.item.reason === 'engine_switched_gap')).toBe(
        true
      )
    } finally {
      history2.close()
    }
  } finally {
    history.close()
    db.close()
  }
})
