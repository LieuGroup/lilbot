/** Guard-removal mutation killers (M1-M6, M11): flush allowed/maxPages, catchUp allowed/excluded, and fail-closed journal tail. */
import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { excludeSession } from '../../server/history/history-exclusion'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'

test('M1-M3: flushBotHistory enforces allowed on bot deletion after list(), listed hidden sessions, and mid-read disallow', async () => {
  // M1: bot deleted / disallowed during source.list().
  {
    const db = openDatabase(':memory:')
    let botAllowed = true
    const source: ConversationSource = {
      list: async () => {
        botAllowed = false
        return [{ id: 's1', at: 10 }]
      },
      read: async () => ({ rows: [{ id: 'r1', at: 11, order: 0, item: { kind: 'user', text: 'x' } }], cursor: 'c', reset: false, empty: true }),
      close: () => {}
    }
    const store = new HistoryStore(db)
    const history = new HistoryService(
      store,
      { id: 'e', conversations: async () => source } as unknown as BotEngine,
      async () => [],
      () => botAllowed
    )
    try {
      await history.flush({ id: 'b1', engineId: 'e', engineBotId: 'n1' })
      expect(store.sessions('b1')).toEqual([])
      expect(store.progress('b1').complete).toBe(false)
    } finally {
      history.close()
      db.close()
    }
  }

  // M2 + M3: hidden listed session is never registered in history_sessions, and session disallowed mid-read writes zero rows.
  {
    const db = openDatabase(':memory:')
    const disallowed = new Set<string>(['hidden-listed'])
    const source: ConversationSource = {
      list: async () => [
        { id: 'hidden-listed', at: 10 },
        { id: 'flips-mid-read', at: 20 }
      ],
      read: async id => {
        if (id === 'flips-mid-read') disallowed.add('flips-mid-read')
        return { rows: [{ id: `row:${id}`, at: 25, order: 0, item: { kind: 'user', text: `secret:${id}` } }], cursor: 'c', reset: false, empty: true }
      },
      close: () => {}
    }
    const store = new HistoryStore(db)
    const history = new HistoryService(
      store,
      { id: 'e', conversations: async () => source } as unknown as BotEngine,
      async () => [],
      (_b, s) => !disallowed.has(s)
    )
    try {
      await history.flush({ id: 'b1', engineId: 'e', engineBotId: 'n1' })
      expect(store.sessions('b1').map(s => s.id)).toEqual(['flips-mid-read'])
      expect(store.page('b1').items.some(r => r.id === 'row:flips-mid-read')).toBe(false)
    } finally {
      history.close()
      db.close()
    }
  }
})

test('M4: catchUpDirtySessions skips disallowed, excluded, and mid-read disallowed sessions', async () => {
  const db = openDatabase(':memory:')
  const disallowed = new Set<string>()
  const readSessions: string[] = []
  const source: ConversationSource = {
    list: async () => [],
    read: async id => {
      readSessions.push(id)
      if (id === 's-mid') disallowed.add('s-mid')
      return { rows: [{ id: `row:${id}`, at: 50, order: 0, item: { kind: 'user', text: `msg:${id}` } }], cursor: 'c', reset: false, empty: true }
    },
    close: () => {}
  }
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    { id: 'e', conversations: async () => source } as unknown as BotEngine,
    async () => [{ id: 'b1', engineId: 'e', engineBotId: 'n1' }],
    (_b, s) => !disallowed.has(s)
  )
  try {
    // Seed s-excl so excludeSession accepts it, then queue s-dis, s-excl, and s-mid before the 25 ms catch-up timer fires.
    store.session('b1', 's-excl', 10)
    store.write('b1', 's-excl', [{ id: 'seed', at: 11, order: 0, item: { kind: 'user', text: 'old' } }])
    history.record('b1', 's-dis', { type: 'turn.finished', status: 'completed', text: 'a' }, 'k1')
    history.record('b1', 's-excl', { type: 'turn.finished', status: 'completed', text: 'b' }, 'k2')
    history.record('b1', 's-mid', { type: 'turn.finished', status: 'completed', text: 'c' }, 'k3')
    disallowed.add('s-dis')
    excludeSession(db, 'b1', 's-excl', 'operator')

    await Bun.sleep(60)
    expect(readSessions).toEqual(['s-mid'])
    expect(store.page('b1').items).toEqual([])
  } finally {
    history.close()
    db.close()
  }
})

test('M5: hidden and operator-excluded journal rows stay fail-closed on committed engine switch', async () => {
  const db = openDatabase(':memory:')
  const engine = {
    id: 'e-down',
    conversations: async () => {
      throw new Error('offline')
    }
  } as unknown as BotEngine
  const store = new HistoryStore(db)
  store.session('b1', 'excluded-op', 30)
  store.write('b1', 'excluded-op', [{ id: 'seed', at: 31, order: 0, item: { kind: 'user', text: 'secret' } }])
  excludeSession(db, 'b1', 'excluded-op', 'operator removal')
  for (const [sess, text, key] of [
    ['visible', 'keep visible', 'vk1'],
    ['hidden-compressed', 'leaked hidden', 'hk1'],
    ['excluded-op', 'leaked excluded', 'xk1']
  ] as const) {
    db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)').run(
      'b1',
      sess,
      40,
      JSON.stringify({ type: 'user.message', messageId: key, text, attachments: [], images: { support: 'unknown', imageCount: 0 } }),
      key
    )
  }
  const history = new HistoryService(
    store,
    engine,
    async () => [],
    (_b, s) => s !== 'hidden-compressed'
  )
  try {
    const sw = await history.prepareEngineSwitch({ id: 'b1', engineId: 'e-down', engineBotId: 'n1' })
    sw.commit('new-chat')
    const userItems = store.page('b1').items.filter(r => r.item.kind === 'user')
    expect(userItems.map(r => r.sessionId)).toEqual(['visible'])
    expect(userItems.some(r => r.item.kind === 'user' && (r.item.text.includes('hidden') || r.item.text.includes('excluded')))).toBe(false)
  } finally {
    history.close()
    db.close()
  }
})

test('M11: flushBotHistory enforces maxPages cap and returns incomplete: true', async () => {
  const db = openDatabase(':memory:')
  let readCalls = 0
  const source: ConversationSource = {
    list: async () => [{ id: 'big', at: 10 }],
    read: async (_id, cursor) => {
      readCalls++
      const n = Number(cursor ?? 0)
      if (n >= 10) return { rows: [], cursor: '10', reset: false, empty: true }
      return { rows: [{ id: `p:${n}`, at: 100 + n, order: n, item: { kind: 'user', text: `page ${n}` } }], cursor: String(n + 1), reset: false, empty: false }
    },
    close: () => {}
  }
  const store = new HistoryStore(db)
  const history = new HistoryService(
    store,
    { id: 'e', conversations: async () => source } as unknown as BotEngine,
    async () => [],
    () => true
  )
  try {
    const res = await history.flush({ id: 'b1', engineId: 'e', engineBotId: 'n1' }, { maxPages: 3 })
    expect(readCalls).toBe(3)
    expect(res).toEqual({ incomplete: true, imported: 3 })
  } finally {
    history.close()
    db.close()
  }
})
