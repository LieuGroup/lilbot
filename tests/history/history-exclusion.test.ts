import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { excludeSession, previewExclusion } from '../../server/history/history-exclusion'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'

const user = (id: string, at: number, text: string) => ({ id, at, order: at, item: { kind: 'user' as const, text } })
const reply = (id: string, at: number, text: string) => ({ id, at, order: at, item: { kind: 'assistant' as const, text } })

function seeded() {
  const db = openDatabase(':memory:')
  const store = new HistoryStore(db)
  for (const [id, at] of [
    ['old', 1],
    ['mid', 10],
    ['new', 20]
  ] as const)
    store.session('a', id, at)
  store.write('a', 'old', [user('o1', 1, 'zebra test prompt'), reply('o2', 2, 'zebra test answer')], 'c', true)
  store.write('a', 'mid', [user('m1', 11, 'keep me')], 'c', true)
  store.write('a', 'new', [user('n1', 21, 'also kept')], 'c', true)
  store.discovered('a')
  for (const id of ['mid', 'new']) store.divider('a', id, id === 'mid' ? 10 : 20)
  store.event('a', 'old', { type: 'turn.finished' } as never, 'k1')
  db.query('INSERT INTO bot_prefs(bot_id,main_chat_id) VALUES(?,?)').run('a', 'new')
  return { db, store }
}

test('exclusion removes rows, journal, search hits and the divider, and moves the start marker', () => {
  const { db, store } = seeded()
  try {
    const before = store.page('a', undefined, 2).nextCursor // cursor taken before the exclusion
    expect(previewExclusion(db, 'a', 'old')).toMatchObject({ already: false, kinds: { user: 1, assistant: 1 }, events: 1 })
    expect(store.search('a', 'zebra')).toHaveLength(2)
    expect(excludeSession(db, 'a', 'old', 'test turns')).toBe(true)
    expect(store.search('a', 'zebra')).toEqual([])
    expect(store.sessions('a').map(s => s.id)).toEqual(['mid', 'new'])
    expect(db.query('SELECT count(*) n FROM history_events WHERE session=?').get('old')).toEqual({ n: 0 })
    const all = store.page('a')
    expect(all.items.map(r => r.id)).toEqual(['m1', 'session:new', 'n1']) // first remaining session has no divider
    expect(all.start).toEqual({ at: 10 })
    expect(store.page('a', before ?? undefined).items.every(r => r.sessionId !== 'old')).toBe(true)
    expect(db.query('SELECT reason FROM history_exclusions').get()).toEqual({ reason: 'test turns' })
  } finally {
    db.close()
  }
})

test('writers skip an excluded session: write, reference, divider, session and journal', () => {
  const { db, store } = seeded()
  try {
    excludeSession(db, 'a', 'old', 'x')
    store.session('a', 'old', 1)
    store.write('a', 'old', [user('o1', 1, 'zebra again')], 'c', true)
    store.reference('a', 'old', { kind: 'tool', toolId: 't', name: 'terminal', status: 'done' } as never, 3)
    store.divider('a', 'old', 1)
    store.event('a', 'old', { type: 'turn.finished' } as never, 'k2')
    expect(
      db
        .query(
          'SELECT (SELECT count(*) FROM history_items WHERE session=?)+(SELECT count(*) FROM history_sessions WHERE id=?)+(SELECT count(*) FROM history_events WHERE session=?) n'
        )
        .get('old', 'old', 'old')
    ).toEqual({ n: 0 })
    expect(store.search('a', 'zebra')).toEqual([])
  } finally {
    db.close()
  }
})

test('re-import after a checkpoint rewind never brings the session back; live record and replay skip it', async () => {
  const { db, store } = seeded()
  const source: ConversationSource = {
    list: async () => [
      { id: 'old', at: 1 },
      { id: 'mid', at: 10 },
      { id: 'new', at: 20 }
    ],
    read: async (id, cursor) => ({ rows: cursor ? [] : [user(`${id}-x`, 5, `zebra ${id}`)], cursor: 'c', reset: false, empty: !!cursor }),
    close() {}
  }
  const service = new HistoryService(
    store,
    { conversations: async () => source } as unknown as BotEngine,
    async () => [{ id: 'a', engineBotId: 'n' }],
    () => true
  )
  try {
    excludeSession(db, 'a', 'old', 'x')
    db.exec('UPDATE history_sessions SET cursor=NULL,complete=0') // what migration 19 did
    service.record('a', 'old', { type: 'turn.finished' } as never)
    for (let i = 0; i < 8; i++) await service.tick()
    expect(store.sessions('a').map(s => s.id)).toEqual(['mid', 'new'])
    expect(store.page('a').items.some(r => r.sessionId === 'old')).toBe(false)
    expect((store.search('a', 'zebra') as { sessionId: string }[]).every(m => m.sessionId !== 'old')).toBe(true)
    expect(db.query("SELECT count(*) n FROM history_events WHERE session='old'").get()).toEqual({ n: 0 })
    expect(store.progress('a').complete).toBe(true)
  } finally {
    service.close()
    db.close()
  }
})

test('the main session is refused, an unknown session is refused, and a repeat is a no-op', () => {
  const { db } = seeded()
  try {
    expect(() => excludeSession(db, 'a', 'new', 'x')).toThrow('current main session')
    expect(() => previewExclusion(db, 'a', 'new')).toThrow('current main session')
    expect(() => excludeSession(db, 'a', 'typo', 'x')).toThrow('no such session')
    expect(db.query("SELECT count(*) n FROM history_items WHERE session='new'").get()).toEqual({ n: 2 })
    expect(excludeSession(db, 'a', 'old', 'first')).toBe(true)
    expect(excludeSession(db, 'a', 'old', 'second')).toBe(false)
    expect(previewExclusion(db, 'a', 'old').already).toBe(true)
    expect(db.query('SELECT reason FROM history_exclusions').all()).toEqual([{ reason: 'first' }])
  } finally {
    db.close()
  }
})

test('a writer that raced the exclusion leaves no visible session or incomplete progress', () => {
  const { db, store } = seeded()
  try {
    db.query("INSERT INTO history_exclusions(bot,session,reason,at) VALUES('a','ghost','race',1)").run()
    store.session('a', 'ghost', 1)
    store.divider('a', 'ghost', 1)
    store.event('a', 'ghost', { type: 'turn.finished' } as never, 'k')
    expect(store.sessions('a').map(s => s.id)).toEqual(['old', 'mid', 'new'])
    expect(db.query("SELECT count(*) n FROM history_sessions WHERE id='ghost'").get()).toEqual({ n: 0 })
    db.query("INSERT INTO history_sessions(bot,id,at) VALUES('a','ghost',1)").run() // a stray row from an older writer
    expect(store.sessions('a').map(s => s.id)).toEqual(['old', 'mid', 'new'])
    expect(store.progress('a')).toMatchObject({ sessions: 3, completed: 3, complete: true })
  } finally {
    db.close()
  }
})
