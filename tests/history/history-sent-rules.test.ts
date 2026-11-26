/** One test per part of the placing rule (`history-sent.ts`) that a reviewer could delete without another test noticing.
 *  Every journal moment and engine time is set exactly. */
import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'
import { finished, journal, reply, sent, shownTexts, started, T, tool, toolDone, toolRow, user, words } from './history-sent-fixture'

const run = (steps: (store: HistoryStore, db: ReturnType<typeof openDatabase>) => void) => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    store.session('b', 's', T - 120_000)
    steps(store, db)
    return shownTexts(store)
  } finally {
    db.close()
  }
}

test('a tool the hidden turn started after the message was sent sits below the message', () => {
  const order = run((store, db) => {
    journal(store, db, [
      [T, started],
      [T + 1000, sent('sent while busy')],
      [T + 2000, tool('t1')],
      [T + 8000, toolDone('t1')],
      [T + 8001, words('The river ')],
      [T + 9000, finished('The river is connected.', 'e:2')]
    ])
    store.write('b', 's', [toolRow(1, T + 2010, 't1'), reply(2, T + 8001, 'The river is connected.'), user(3, T + 9001, 'sent while busy')])
  })
  expect(order).toEqual(['sent while busy', 'tool:t1', 'The river is connected.'])
})

test('words the hidden turn showed before its second tool, after the message was sent, sit below the message', () => {
  const order = run((store, db) => {
    journal(store, db, [
      [T, started],
      [T + 10, tool('t1')],
      [T + 1000, sent('sent while busy')],
      [T + 3000, toolDone('t1')],
      [T + 3001, words('Checking more.')],
      [T + 3500, tool('t2')],
      [T + 6000, toolDone('t2')],
      [T + 6001, words('Done.')],
      [T + 7000, finished('Done.', 'e:4')]
    ])
    store.write('b', 's', [
      toolRow(1, T + 20, 't1'),
      reply(2, T + 3001, 'Checking more.'),
      toolRow(3, T + 3510, 't2'),
      reply(4, T + 6001, 'Done.'),
      user(5, T + 7001, 'sent while busy')
    ])
  })
  expect(order).toEqual(['tool:t1', 'sent while busy', 'Checking more.', 'tool:t2', 'Done.'])
})

test('a reply from an earlier turn whose end LilBot never journalled stays above a message sent during a later open turn', () => {
  const order = run((store, db) => {
    store.write('b', 's', [user(1, T - 60_000, 'earlier question'), reply(2, T - 59_000, 'Earlier answer.')])
    journal(store, db, [
      [T, started],
      [T + 1000, sent('sent while busy')],
      [T + 2000, words('The river ')]
    ])
    // The importer reads the hidden reply while its turn is still open, and the message the engine already stored after it.
    store.write('b', 's', [reply(3, T + 2000, 'The river is connected.'), user(4, T + 3000, 'sent while busy')])
  })
  expect(order).toEqual(['earlier question', 'Earlier answer.', 'sent while busy', 'The river is connected.'])
})

test('a hidden turn queued before the message, read while still open, sits below the message when its words showed after it was sent', () => {
  const order = run((store, db) => {
    journal(store, db, [
      [T, started],
      [T + 10, tool('t1')],
      [T + 1000, sent('sent while busy')],
      [T + 3000, toolDone('t1')],
      [T + 3001, words('First ')],
      [T + 4000, finished('First hidden reply.', 'e:2')],
      [T + 4001, started],
      [T + 4100, words('Second ')]
    ])
    store.write('b', 's', [toolRow(1, T + 20, 't1'), reply(2, T + 3001, 'First hidden reply.'), reply(3, T + 4100, 'Second hidden reply.'), user(4, T + 5000, 'sent while busy')])
  })
  expect(order).toEqual(['tool:t1', 'sent while busy', 'First hidden reply.', 'Second hidden reply.'])
})
