/** Regression tests for LILA-48 Probes A, 1A, and 1B: rowId ordering (M6) and keyset paging cursor stability. */
import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { planBotJournalTail } from '../../server/history/history-tail-plan'

test('PROBE_A_REALISTIC + M6: journal rows never reuse bare event.rowId and canonical rows replace them in exact engine order', () => {
  const db = openDatabase(':memory:')
  const store = new HistoryStore(db)
  try {
    const now = 10_000
    const addEvt = (at: number, event: unknown, key: string) =>
      db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)').run('b1', 's1', at, JSON.stringify(event), key)

    addEvt(now, { type: 'user.message', messageId: 'u1', text: 'turn 1', attachments: [], images: { support: 'unknown', imageCount: 0 } }, 'k1')
    addEvt(now + 1, { type: 'turn.finished', status: 'completed', text: 'reply 1', rowId: 'eng:r1' }, 'k2')
    addEvt(now + 2, { type: 'user.message', messageId: 'u2', text: 'turn 2', attachments: [], images: { support: 'unknown', imageCount: 0 } }, 'k3')
    addEvt(now + 3, { type: 'turn.finished', status: 'completed', text: 'reply 2', rowId: 'eng:r2', compacted: { beforeTokens: 120_000, afterTokens: 24_000 } }, 'k4')

    const plan = planBotJournalTail(
      store,
      'b1',
      () => true,
      (_b, _s, r) => r
    )
    expect(plan.truncated).toBe(false)
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0].rows.every(r => r.id.startsWith('journal:'))).toBe(true)
    store.session('b1', 's1', now)
    store.write('b1', 's1', plan.entries[0].rows)
    expect(store.page('b1').items.map(r => r.item.kind)).toEqual(['user', 'assistant', 'user', 'compaction', 'assistant'])

    // Canonical engine rows arrive with earlier engine timestamps (now - 2000 .. now - 800).
    store.write('b1', 's1', [
      { id: 'eng:u1', at: now - 2000, order: 0, item: { kind: 'user', text: 'turn 1' } },
      { id: 'eng:r1', at: now - 1800, order: 1, item: { kind: 'assistant', text: 'reply 1' } },
      { id: 'eng:c1', at: now - 1200, order: 1.5, item: { kind: 'compaction', beforeTokens: 120_000, afterTokens: 24_000 } },
      { id: 'eng:u2', at: now - 1000, order: 2, item: { kind: 'user', text: 'turn 2' } },
      { id: 'eng:r2', at: now - 800, order: 3, item: { kind: 'assistant', text: 'reply 2' } }
    ])
    const items = store.page('b1').items
    expect(items.map(r => r.id)).toEqual(['eng:u1', 'eng:r1', 'eng:c1', 'eng:u2', 'eng:r2'])
    expect(items.map(r => ('text' in r.item ? r.item.text : r.item.kind))).toEqual(['turn 1', 'reply 1', 'compaction', 'turn 2', 'reply 2'])
  } finally {
    db.close()
  }
})

test('PROBE_1A & PROBE_1B: aborted switch or live flush never emits replaceable journal rows, keeping paging cursors stable for both clock skews', async () => {
  for (const canonicalDelta of [-5000, +5000]) {
    const db = openDatabase(':memory:')
    const base = Date.now()
    let offline = true
    const canonical = [
      { id: 'c1', at: base + canonicalDelta, order: 0, item: { kind: 'user' as const, text: 'turn one' } },
      { id: 'c2', at: base + canonicalDelta + 1, order: 1, item: { kind: 'assistant' as const, text: 'reply one' } },
      { id: 'c3', at: base + canonicalDelta + 2, order: 2, item: { kind: 'user' as const, text: 'turn two' } },
      { id: 'c4', at: base + canonicalDelta + 3, order: 3, item: { kind: 'assistant' as const, text: 'reply two' } }
    ]
    const source: ConversationSource = {
      list: async () => [{ id: 's1', at: base - 10_000 }],
      read: async (_id, cursor) => ({ rows: cursor ? [] : canonical, cursor: 'end', reset: false, empty: !!cursor }),
      close: () => {}
    }
    const engine = {
      id: 'e1',
      conversations: async () => {
        if (offline) throw new Error('down')
        return source
      }
    } as unknown as BotEngine
    const store = new HistoryStore(db)
    const history = new HistoryService(
      store,
      engine,
      async () => [{ id: 'b1', engineId: 'e1', engineBotId: 'n1' }],
      () => true
    )
    try {
      store.session('b1', 's1', base - 10_000)
      store.write('b1', 's1', canonical.slice(0, 2))
      store.event('b1', 's1', { type: 'user.message', messageId: 'm2', text: 'turn two', attachments: [], images: { support: 'unknown', imageCount: 0 } }, 'k1')
      store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'reply two', rowId: 'c4' }, 'k2')

      await history.flush({ id: 'b1', engineId: 'e1', engineBotId: 'n1' })
      const aborted = await history.prepareEngineSwitch({ id: 'b1', engineId: 'e1', engineBotId: 'n1' })
      aborted.release()
      expect(store.page('b1').items.map(r => r.id)).toEqual(['c1', 'c2'])

      offline = false
      await history.tick()
      const p1 = store.page('b1', undefined, 2)
      const p2 = store.page('b1', p1.nextCursor!, 2)
      expect(p1.items.map(r => r.id)).toEqual(['c3', 'c4'])
      expect(p2.items.map(r => r.id)).toEqual(['c1', 'c2'])
    } finally {
      history.close()
      db.close()
    }
  }
})
