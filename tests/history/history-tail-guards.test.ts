/** Idempotency, tick/flush racing, canonical row replacement, and fail-closed hidden/excluded session guards. */
import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { excludeSession } from '../../server/history/history-exclusion'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'

test('repeated flush, tick race, and later engine recovery after journal reconciliation never duplicate or reorder rows', async () => {
  const db = openDatabase(':memory:')
  let failEngine = true
  const engineRows = [
    { id: 'eng:1', at: 100, order: 0, item: { kind: 'user' as const, text: 'hello' } },
    { id: 'eng:tool:t1', at: 101, order: 1, item: { kind: 'tool' as const, toolId: 't1', name: 'terminal', detail: 'ls', running: false } },
    { id: 'eng:2', at: 102, order: 2, item: { kind: 'assistant' as const, text: 'world' } }
  ]
  const source: ConversationSource = {
    list: async () => [{ id: 's1', at: 100 }],
    read: async (_id, cursor) => ({ rows: cursor ? [] : engineRows, cursor: 'end', reset: false, empty: !!cursor }),
    close: () => {}
  }
  const engine = {
    id: 'test-engine',
    conversations: async () => {
      if (failEngine) throw new Error('offline')
      return source
    }
  } as unknown as BotEngine
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    engine,
    async () => [{ id: 'b1', engineId: 'test-engine', engineBotId: 'n1' }],
    () => true
  )
  try {
    store.event('b1', 's1', { type: 'user.message', messageId: 'u1', text: 'hello', attachments: [], images: { support: 'unknown', imageCount: 0 } }, 'e1')
    store.event('b1', 's1', { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'ls' }, 'e2')
    store.event('b1', 's1', { type: 'tool.finished', toolId: 't1', failed: false }, 'e3')
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'world' }, 'e4')

    // Reconcile twice while offline: second call must write zero duplicates.
    const r1 = await history.flush({ id: 'b1', engineId: 'test-engine', engineBotId: 'n1' })
    const r2 = await history.flush({ id: 'b1', engineId: 'test-engine', engineBotId: 'n1' })
    expect(r1).toEqual({ incomplete: true, imported: 0, reconciled: 3 })
    expect(r2).toEqual({ incomplete: true, imported: 0, reconciled: 0 })
    expect(store.page('b1').items.map(r => r.item.kind)).toEqual(['user', 'tool', 'assistant'])

    // Now the engine recovers and tick() races with flush(): canonical engine rows supersede journal placeholders without duplicating!
    failEngine = false
    const [f1, , f2] = await Promise.all([
      history.flush({ id: 'b1', engineId: 'test-engine', engineBotId: 'n1' }),
      history.tick(),
      history.flush({ id: 'b1', engineId: 'test-engine', engineBotId: 'n1' })
    ])
    expect(f1.incomplete).toBe(false)
    expect(f2.incomplete).toBe(false)
    const items = store.page('b1').items
    expect(items.map(r => r.id)).toEqual(['eng:1', 'eng:tool:t1', 'eng:2'])
    expect(items.map(r => r.item.kind)).toEqual(['user', 'tool', 'assistant'])
  } finally {
    history.close()
    db.close()
  }
})

test('hidden and operator-excluded sessions stay fail-closed across flush, journal reconciliation, and post-turn catch-up', async () => {
  const db = openDatabase(':memory:')
  const source: ConversationSource = {
    list: async () => [
      { id: 'visible', at: 10 },
      { id: 'hidden-compressed', at: 20 },
      { id: 'excluded-op', at: 30 }
    ],
    read: async (id, cursor) => ({
      rows: cursor ? [] : [{ id: `row:${id}`, at: 50, order: 0, item: { kind: 'user' as const, text: `msg in ${id}` } }],
      cursor: 'done',
      reset: false,
      empty: !!cursor
    }),
    close: () => {}
  }
  let offline = false
  const engine = {
    id: 'test-engine',
    conversations: async () => {
      if (offline) throw new Error('offline')
      return source
    }
  } as unknown as BotEngine
  const store = new HistoryStore(db)
  // Seed excluded-op then exclude it via operator API.
  store.session('b1', 'excluded-op', 30)
  store.write('b1', 'excluded-op', [{ id: 'seed', at: 31, order: 0, item: { kind: 'user', text: 'secret' } }])
  excludeSession(db, 'b1', 'excluded-op', 'operator removal')
  // Seed raw journal rows for both hidden-compressed and excluded-op to prove journal reconciliation stays fail-closed.
  db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)').run(
    'b1',
    'hidden-compressed',
    21,
    JSON.stringify({ type: 'user.message', messageId: 'h1', text: 'leaked hidden', attachments: [], images: { support: 'unknown', imageCount: 0 } }),
    'hk1'
  )
  db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)').run(
    'b1',
    'excluded-op',
    32,
    JSON.stringify({ type: 'user.message', messageId: 'x1', text: 'leaked excluded', attachments: [], images: { support: 'unknown', imageCount: 0 } }),
    'xk1'
  )

  // Fail-closed allowed(): hidden-compressed is denied (simulating unreadable compression lineage or hidden root).
  const history = new HistoryService(
    store,
    engine,
    async () => [{ id: 'b1', engineId: 'test-engine', engineBotId: 'n1' }],
    (_b, s) => s !== 'hidden-compressed'
  )
  try {
    await history.flush({ id: 'b1', engineId: 'test-engine', engineBotId: 'n1' })
    offline = true
    await history.flush({ id: 'b1', engineId: 'test-engine', engineBotId: 'n1' })
    const items = store.page('b1').items
    expect(items.map(r => r.sessionId)).toEqual(['visible'])
    expect(items.some(r => 'text' in r.item && (r.item.text.includes('hidden') || r.item.text.includes('excluded')))).toBe(false)
  } finally {
    history.close()
    db.close()
  }
})
