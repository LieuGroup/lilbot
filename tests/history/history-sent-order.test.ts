import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'

const sent = (text: string, messageId: string) => ({ type: 'user.message' as const, messageId, text, attachments: [], images: { support: 'unknown' as const, imageCount: 0 } })
const texts = (store: HistoryStore) => store.page('b').items.map(row => ('text' in row.item ? row.item.text : row.item.kind))

test("a message sent while a hidden turn runs is shown above that turn's reply, even though the engine stores it after", () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    store.session('b', 's', 1)
    const now = Date.now()
    store.write('b', 's', [
      { id: 'e:1', at: now - 60_000, order: 1, item: { kind: 'user', text: 'connect paper' } },
      { id: 'e:2', at: now - 59_000, order: 2, item: { kind: 'assistant', text: 'Sign in here.' } }
    ])
    // The hidden "service connected" turn runs; he sends a message while it streams; the engine starts on it afterwards.
    store.event('b', 's', { type: 'turn.started' }, 'h1')
    store.event('b', 's', { type: 'text.delta', text: 'Paper is ' }, 'h2')
    store.event('b', 's', sent('i have connected paper mcp to lilbot', 'm1'), 'u1')
    store.event('b', 's', { type: 'turn.finished', status: 'completed', text: 'Paper is connected.', rowId: 'e:3' }, 'h3')
    const engineStamp = now + 1_000
    store.write('b', 's', [
      { id: 'e:3', at: engineStamp, order: 3, item: { kind: 'assistant', text: 'Paper is connected.' } },
      { id: 'e:4', at: engineStamp + 1, order: 4, item: { kind: 'user', text: 'i have connected paper mcp to lilbot' } },
      { id: 'e:5', at: engineStamp + 5_000, order: 5, item: { kind: 'assistant', text: 'Great.' } }
    ])
    expect(texts(store)).toEqual(['connect paper', 'Sign in here.', 'Paper is connected.', 'i have connected paper mcp to lilbot', 'Great.'])
    const at = Object.fromEntries(store.page('b').items.map(row => [row.id, row.at]))
    // He sent it after the reply began to show, so nothing moves: both keep the engine's place.
    expect([at['e:3'], at['e:4']]).toEqual([engineStamp, engineStamp + 1])
    // Importing the same page again gives the same places; the journal copy of the message is not shown twice.
    store.write('b', 's', [{ id: 'e:4', at: engineStamp + 1, order: 4, item: { kind: 'user', text: 'i have connected paper mcp to lilbot' } }])
    expect(store.page('b').items.filter(row => row.item.kind === 'user')).toHaveLength(2)
    expect(store.page('b').items.find(row => row.id === 'e:4')?.at).toBe(engineStamp + 1)
  } finally {
    db.close()
  }
})

test('a message the engine wrote before its journal time stays where the engine put it', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    store.session('b', 's', 1)
    store.event('b', 's', sent('hello', 'm1'), 'u1')
    const mine = (db.query("SELECT at FROM history_events WHERE key='u1'").get() as { at: number }).at
    store.write('b', 's', [{ id: 'e:1', at: mine - 2_000, order: 1, item: { kind: 'user', text: 'hello' } }])
    expect(store.page('b').items[0].at).toBe(mine - 2_000)
  } finally {
    db.close()
  }
})

test("a hidden turn's reply imported before its turn is journalled as finished still sits below a message sent before it showed", () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    store.session('b', 's', 1)
    store.event('b', 's', { type: 'turn.started' }, 'h1')
    store.event('b', 's', { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'sleep 8' }, 'h2')
    store.event('b', 's', sent('sent while busy', 'm1'), 'u1')
    store.event('b', 's', { type: 'tool.finished', toolId: 't1', failed: false }, 'h3')
    store.event('b', 's', { type: 'text.delta', text: 'The river ' }, 'h4')
    db.query('UPDATE history_events SET at=at+rowid*1000').run()
    const engineStamp = Date.now() + 10_000
    // The importer reads the stored reply before LilBot has journalled the turn's end, then the message the engine started on next.
    store.write('b', 's', [{ id: 'e:4', at: engineStamp, order: 4, item: { kind: 'assistant', text: 'The river service is connected.' } }])
    store.event('b', 's', { type: 'turn.finished', status: 'completed', text: 'The river service is connected.', rowId: 'e:4' }, 'h5')
    store.write('b', 's', [
      { id: 'e:5', at: engineStamp + 1, order: 5, item: { kind: 'user', text: 'sent while busy' } },
      { id: 'e:6', at: engineStamp + 3_000, order: 6, item: { kind: 'assistant', text: 'Got it.' } }
    ])
    expect(texts(store)).toEqual(['sent while busy', 'The river service is connected.', 'Got it.'])
  } finally {
    db.close()
  }
})
