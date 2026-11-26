import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'

// The journal is never pruned and every streamed chunk is an event, so placing a page must not grow with it: the page is
// written under the write lock that live replies wait behind.
test('placing an imported page on a 150k-event journal takes milliseconds, not a scan of the journal', () => {
  const db = openDatabase(':memory:')
  try {
    const store = new HistoryStore(db)
    store.session('b', 's', 1)
    const t0 = Date.now() - 10_000_000
    const event = db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)')
    const item = db.query('INSERT INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?,?,?,?)')
    db.transaction(() => {
      for (let turn = 0; turn < 3000; turn++) {
        const at = t0 + turn * 2000
        event.run('b', 's', at, JSON.stringify({ type: 'user.message', messageId: `m${turn}`, text: `message ${turn}`, attachments: [] }), `u${turn}`)
        event.run('b', 's', at + 1, JSON.stringify({ type: 'turn.started' }), `s${turn}`)
        for (let chunk = 0; chunk < 47; chunk++) event.run('b', 's', at + 2 + chunk, JSON.stringify({ type: 'text.delta', text: 'chunk ' }), `d${turn}:${chunk}`)
        event.run('b', 's', at + 1500, JSON.stringify({ type: 'turn.finished', status: 'completed', text: `reply ${turn}`, rowId: `e:${2 * turn + 1}` }), `f${turn}`)
        item.run('b', 's', `e:${2 * turn}`, at + 5, 2 * turn, JSON.stringify({ kind: 'user', text: `message ${turn}` }), `message ${turn}`)
        item.run('b', 's', `e:${2 * turn + 1}`, at + 1600, 2 * turn + 1, JSON.stringify({ kind: 'assistant', text: `reply ${turn}` }), `reply ${turn}`)
      }
    })()
    const page = Array.from({ length: 100 }, (_, i) => ({
      id: `e:${6000 + i}`,
      at: t0 + 7_000_000 + i * 1000,
      order: 6000 + i,
      item: i % 2 ? { kind: 'assistant' as const, text: `new reply ${i}` } : { kind: 'user' as const, text: `new message ${i}` }
    }))
    store.write('b', 's', page.slice(0, 2))
    const start = performance.now()
    store.write('b', 's', page.slice(2))
    expect(performance.now() - start).toBeLessThan(80)
  } finally {
    db.close()
  }
})
