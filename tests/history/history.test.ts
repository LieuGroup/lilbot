import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import type { BotEngine, ConversationSource } from '../../server/engines/bot-engine'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'

const row = (n: number) => ({ id: `row:${n}`, at: n, order: n, item: { kind: 'user' as const, text: `orchid ${n}` } })
test('stable cursor paging, chronological sessions, dividers, start and search scope', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    store.session('a', 'old', 1)
    store.session('a', 'new', 10)
    store.session('b', 'other', 1)
    store.write('a', 'old', [row(1), row(2)], null, true)
    store.write('a', 'new', [row(11)], null, true)
    store.divider('a', 'new', 10)
    store.write('b', 'other', [row(99)], null, true)
    store.discovered('a')
    const last = store.page('a', undefined, 2)
    expect(last.items.map(r => r.id)).toEqual(['session:new', 'row:11'])
    expect(last.start).toBeNull()
    store.write('a', 'new', [row(12)]) // a later arrival must not shift the older page
    const first = store.page('a', last.nextCursor!, 2)
    expect(first.items.map(r => r.id)).toEqual(['row:1', 'row:2'])
    expect(first.nextCursor).toBeNull()
    expect(first.start).toEqual({ at: 1 })
    expect(() => store.page('b', last.nextCursor!)).toThrow('invalid')
    expect(store.search('a', 'orchid')).toHaveLength(4)
    store.forget('a')
    expect(store.search('a', 'orchid')).toEqual([])
    expect(store.search('b', 'orchid')).toHaveLength(1)
  } finally {
    db.close()
  }
})

test('import resumes a committed page after restart, is idempotent and skips internal sessions', async () => {
  const db = openDatabase(':memory:')
  const calls: (string | null | undefined)[] = []
  const source: ConversationSource = {
    list: async () => [
      { id: 'old', at: 1 },
      { id: 'routine', at: 3 },
      { id: 'thread', at: 5 }
    ],
    read: async (_id, cursor) => {
      calls.push(cursor)
      return { rows: cursor ? [] : [row(1)], cursor: 'checkpoint', reset: false, empty: !!cursor }
    },
    close() {}
  }
  const engine = { conversations: async () => source } as unknown as BotEngine
  const store = new HistoryStore(db)
  const service = () =>
    new HistoryService(
      store,
      engine,
      async () => [{ id: 'a', engineBotId: 'native' }],
      (_b, s) => s === '' || s === 'old'
    )
  try {
    const one = service()
    await one.tick()
    expect(store.progress('a').complete).toBe(false)
    one.close()
    const restarted = service()
    await restarted.tick()
    await restarted.tick()
    expect(calls).toEqual([null, 'checkpoint', 'checkpoint'])
    expect(store.progress('a')).toEqual({ complete: true, sessions: 1, completed: 1, items: 1 })
    expect(store.page('a').items).toHaveLength(1)
    restarted.close()
  } finally {
    db.close()
  }
})

test('observer replay is journalled once and equal-time references survive paging', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    store.session('a', 's', 1)
    for (let i = 0; i < 2; i++) store.event('a', 's', { type: 'text.delta', text: 'partial' }, 'epoch:1')
    expect(db.query('SELECT count(*) n FROM history_events').get()).toEqual({ n: 1 })
    for (const id of ['t1', 't2']) store.reference('a', 's', { kind: 'tool', toolId: id, threadId: id, name: 'message to', detail: 'helper', running: false }, 2)
    const page = store.page('a', undefined, 1)
    expect(store.page('a', page.nextCursor!, 1).items[0].id).not.toBe(page.items[0].id)
    expect(store.search('a', 'helper')).toEqual([])
  } finally {
    db.close()
  }
})

test('a finished import stays complete while new turns are read', async () => {
  const db = openDatabase(':memory:')
  let more = false
  const source: ConversationSource = {
    list: async () => [{ id: 'old', at: 1 }],
    read: async (_id, cursor) => ({ rows: cursor && more ? [row(2)] : cursor ? [] : [row(1)], cursor: 'checkpoint', reset: false, empty: !!cursor && !more }),
    close() {}
  }
  const store = new HistoryStore(db)
  const service = new HistoryService(
    store,
    { conversations: async () => source } as unknown as BotEngine,
    async () => [{ id: 'a', engineBotId: 'native' }],
    () => true
  )
  try {
    await service.tick()
    await service.tick()
    expect(store.progress('a').complete).toBe(true)
    more = true
    service.record('a', 'old', { type: 'turn.finished' } as never)
    await service.tick()
    expect(store.progress('a')).toMatchObject({ complete: true, items: 2 })
    expect(store.page('a').start).toEqual({ at: 1 })
    more = false
    await service.tick()
    expect(store.progress('a').complete).toBe(true)
    service.close()
  } finally {
    db.close()
  }
})
