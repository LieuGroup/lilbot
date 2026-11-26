/** Where a message sent while the bot was busy goes, decided by the journal's order alone: every journal moment and
 *  engine time below is set exactly, so each case runs the same on every machine and every run. */
import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'
import { finished, journal, reply, sent, shownTexts, started, T, tool, toolDone, toolRow, user, words } from './history-sent-fixture'

const fresh = () => {
  const db = openDatabase(':memory:')
  const store = new HistoryStore(db)
  store.session('b', 's', T - 60_000)
  return { db, store }
}

/** A hidden turn runs a tool; he sends a message while it runs; the reply's words show after; then his turn. */
const busyTurn: Parameters<typeof journal>[2] = [
  [T, started],
  [T + 10, tool('t1')],
  [T + 1000, sent('sent while busy')],
  [T + 8000, toolDone('t1')],
  [T + 8001, words('The river ')],
  [T + 9000, finished('The river is connected.', 'e:2')],
  [T + 9001, started],
  [T + 9500, words('Got ')],
  [T + 10_000, finished('Got it.', 'e:4')]
]
const busyRows = (delta: number) => [
  toolRow(1, T + 20, 't1'),
  reply(2, T + 8001 + delta, 'The river is connected.'),
  user(3, T + 9001, 'sent while busy'),
  reply(4, T + 9500, 'Got it.')
]
const busyOrder = ['tool:t1', 'sent while busy', 'The river is connected.', 'Got it.']

for (const [name, delta] of [
  ['before', -100],
  ['the same millisecond as', 0],
  ['after', 500]
] as const)
  test(`the engine's time for the hidden reply ${name} its first words showed: the message sent before them stays above it`, () => {
    const { db, store } = fresh()
    try {
      journal(store, db, busyTurn)
      store.write('b', 's', busyRows(delta))
      expect(shownTexts(store)).toEqual(busyOrder)
      expect(store.page('b').items.find(row => row.id === 'e:3')?.at).toBe(T + 1000)
    } finally {
      db.close()
    }
  })

test('several messages sent during one busy turn stay in the order sent, all above the reply that showed after them', () => {
  const { db, store } = fresh()
  try {
    journal(store, db, [
      ...busyTurn.slice(0, 3),
      [T + 2000, sent('and another')],
      ...busyTurn.slice(3, 6),
      [T + 9001, started],
      [T + 9100, words('One ')],
      [T + 9500, finished('One done.', 'e:4')],
      [T + 9501, started],
      [T + 9600, words('Two ')],
      [T + 9900, finished('Two done.', 'e:6')]
    ])
    store.write('b', 's', [busyRows(0)[0], busyRows(0)[1], user(3, T + 9001, 'sent while busy'), reply(4, T + 9100, 'One done.')])
    store.write('b', 's', [user(5, T + 9501, 'and another'), reply(6, T + 9600, 'Two done.')])
    expect(shownTexts(store)).toEqual(['tool:t1', 'sent while busy', 'and another', 'The river is connected.', 'One done.', 'Two done.'])
  } finally {
    db.close()
  }
})

test('a message sent in the gap between two hidden turns sits between their replies', () => {
  const { db, store } = fresh()
  try {
    journal(store, db, [
      [T, started],
      [T + 100, words('First ')],
      [T + 500, finished('First hidden reply.', 'e:1')],
      [T + 600, sent('in the gap')],
      [T + 601, started],
      [T + 700, words('Second ')],
      [T + 900, finished('Second hidden reply.', 'e:2')],
      [T + 901, started],
      [T + 1000, words('Answer ')],
      [T + 1200, finished('Answer.', 'e:4')]
    ])
    store.write('b', 's', [reply(1, T + 100, 'First hidden reply.'), reply(2, T + 700, 'Second hidden reply.'), user(3, T + 901, 'in the gap'), reply(4, T + 1000, 'Answer.')])
    expect(shownTexts(store)).toEqual(['First hidden reply.', 'in the gap', 'Second hidden reply.', 'Answer.'])
  } finally {
    db.close()
  }
})

test("reading the newest page again, as every chat open does, keeps each row's place and time", () => {
  const { db, store } = fresh()
  try {
    journal(store, db, busyTurn)
    store.write('b', 's', busyRows(0).slice(0, 2))
    store.write('b', 's', busyRows(0))
    const first = store.page('b').items.map(row => [row.id, row.at])
    for (let open = 0; open < 3; open++) store.write('b', 's', busyRows(0))
    expect(store.page('b').items.map(row => [row.id, row.at])).toEqual(first)
    expect(shownTexts(store)).toEqual(busyOrder)
  } finally {
    db.close()
  }
})

test('after a restart the placed rows keep their places, and the next busy message is placed the same way', () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-sent-'))
  try {
    let db = openDatabase(join(dir, 'lilbot.db'))
    let store = new HistoryStore(db)
    store.session('b', 's', T - 60_000)
    journal(store, db, busyTurn)
    store.write('b', 's', busyRows(0).slice(0, 2))
    db.close()
    db = openDatabase(join(dir, 'lilbot.db'))
    store = new HistoryStore(db)
    store.write('b', 's', busyRows(0))
    const later = T + 20_000
    journal(store, db, [
      [later, started],
      [later + 10, tool('t2')],
      [later + 500, sent('after restart')],
      [later + 900, toolDone('t2')],
      [later + 901, words('Again ')],
      [later + 1000, finished('Again connected.', 'e:6')]
    ])
    store.write('b', 's', [...busyRows(0), toolRow(5, later + 10, 't2'), reply(6, later + 901, 'Again connected.'), user(7, later + 1001, 'after restart')])
    db.close()
    db = openDatabase(join(dir, 'lilbot.db'))
    store = new HistoryStore(db)
    expect(shownTexts(store)).toEqual([...busyOrder, 'tool:t2', 'after restart', 'Again connected.'])
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a file the bot showed during the busy turn sits where it showed: above a message sent after it, below one sent before', () => {
  for (const [shownAt, order] of [
    [T + 3000, ['tool:t1', 'sent while busy', 'shown:plan.png', 'The river is connected.', 'Got it.']],
    [T + 500, ['tool:t1', 'shown:plan.png', 'sent while busy', 'The river is connected.', 'Got it.']]
  ] as const) {
    const { db, store } = fresh()
    try {
      journal(store, db, busyTurn)
      const file = { id: 'x', name: 'plan.png', kind: 'image' as const, mime: 'image/png', size: 1, url: '/api/shown/b/x' }
      store.write('b', 's', [toolRow(1, T + 20, 't1')])
      store.write('b', 's', [{ id: 'shown:x', at: shownAt, order: 0, item: { kind: 'shown', file } }])
      store.write('b', 's', busyRows(500))
      expect(shownTexts(store)).toEqual([...order])
    } finally {
      db.close()
    }
  }
})
