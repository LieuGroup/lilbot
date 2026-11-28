import { expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'

const sent = (text: string, messageId: string) => ({ type: 'user.message' as const, messageId, text, attachments: [], images: { support: 'unknown' as const, imageCount: 0 } })
const TURNS = 4000

/** One long session like the owner's main bot at several times its size: 8,000 rows, every one placed, and a journal of
 *  156,000 events (each streamed chunk is one). Every write the conversation makes runs under the write lock that live
 *  replies wait behind, so none may grow with the history. */
function longSession() {
  const db = openDatabase(':memory:')
  const store = new HistoryStore(db)
  store.session('b', 's', 1)
  const t0 = Date.now() - TURNS * 4000 - 60_000
  const event = db.query('INSERT INTO history_events(bot,session,at,event,key) VALUES(?,?,?,?,?)')
  const item = db.query('INSERT INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?,?,?,?)')
  const place = db.query('INSERT INTO history_sent(bot,event,row_id) VALUES(?,?,?)')
  db.transaction(() => {
    for (let turn = 0; turn < TURNS; turn++) {
      const at = t0 + turn * 4000
      const message = event.run('b', 's', at, JSON.stringify(sent(`message ${turn}`, `m${turn}`)), `u${turn}`).lastInsertRowid
      event.run('b', 's', at + 1, JSON.stringify({ type: 'turn.started' }), `s${turn}`)
      const shown = event.run('b', 's', at + 2, JSON.stringify({ type: 'text.delta', text: 'chunk ' }), `d${turn}:0`).lastInsertRowid
      for (let chunk = 1; chunk < 36; chunk++) event.run('b', 's', at + 2 + chunk, JSON.stringify({ type: 'text.delta', text: 'chunk ' }), `d${turn}:${chunk}`)
      event.run('b', 's', at + 1500, JSON.stringify({ type: 'turn.finished', status: 'completed', text: `reply ${turn}`, rowId: `e:${2 * turn + 1}` }), `f${turn}`)
      item.run('b', 's', `e:${2 * turn}`, at, 2 * turn, JSON.stringify({ kind: 'user', text: `message ${turn}` }), `message ${turn}`)
      item.run('b', 's', `e:${2 * turn + 1}`, at + 2, 2 * turn + 1, JSON.stringify({ kind: 'assistant', text: `reply ${turn}` }), `reply ${turn}`)
      place.run('b', message, `e:${2 * turn}`)
      place.run('b', shown, `e:${2 * turn + 1}`)
    }
  })()
  const engineRow = (n: number) => ({
    id: `e:${n}`,
    at: t0 + n * 2000 + 3000,
    order: n,
    item: n % 2 ? { kind: 'assistant' as const, text: `reply ${(n - 1) / 2}` } : { kind: 'user' as const, text: `message ${n / 2}` }
  })
  return { db, store, engineRow }
}

const timed = (fn: () => void) => {
  const start = performance.now()
  fn()
  return performance.now() - start
}

test('every write the conversation makes stays in milliseconds on a long, fully placed session with a large journal', () => {
  const { db, store, engineRow } = longSession()
  try {
    const rows = TURNS * 2
    const ms: Record<string, number> = {}
    // Chat open reads the newest page again: every row is already stored and placed.
    ms.open = timed(() =>
      store.write(
        'b',
        's',
        Array.from({ length: 100 }, (_, i) => engineRow(rows - 100 + i))
      )
    )
    ms.paging = timed(() => store.page('b'))
    store.event('b', 's', { type: 'turn.started' }, 'live-start')
    store.event('b', 's', { type: 'tool.started', toolId: 'x', name: 'terminal', detail: 'sleep 8' }, 'live-tool')
    ms.chunk = timed(() => store.event('b', 's', { type: 'text.delta', text: 'chunk ' }, 'live-d0'))
    ms.busySend = timed(() => store.event('b', 's', sent('sent while busy', 'busy'), 'live-u'))
    store.event('b', 's', { type: 'tool.finished', toolId: 'x', failed: false }, 'live-tool-done')
    db.query('UPDATE history_events SET at=at-1 WHERE key=?').run('live-u')
    store.event('b', 's', { type: 'text.delta', text: 'The river ' }, 'live-d1')
    const later = Date.now() + 9000
    ms.importPage = timed(() =>
      store.write('b', 's', [
        { id: `e:${rows}`, at: later, order: rows, item: { kind: 'assistant', text: 'The river is connected.' } },
        ...Array.from({ length: 99 }, (_, i) => ({
          id: `e:${rows + 1 + i}`,
          at: later + 1 + i,
          order: rows + 1 + i,
          item: i === 0 ? { kind: 'user' as const, text: 'sent while busy' } : { kind: 'assistant' as const, text: `later ${i}` }
        }))
      ])
    )
    ms.turnEnd = timed(() => store.event('b', 's', { type: 'turn.finished', status: 'completed', text: 'The river is connected.', rowId: `e:${rows}` }, 'live-f'))
    for (const [path, took] of Object.entries(ms)) expect({ path, slow: took > 60 }).toEqual({ path, slow: false })
    const shown = store
      .page('b')
      .items.map(row => ('text' in row.item ? row.item.text : ''))
      .filter(text => text === 'sent while busy' || text === 'The river is connected.')
    expect(shown).toEqual(['sent while busy', 'The river is connected.'])
  } finally {
    db.close()
  }
})
