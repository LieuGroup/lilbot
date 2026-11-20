import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import type { BotEngine } from '../../server/engines/bot-engine'
import { historyRows } from '../../server/engines/hermes/hermes-history-mapping'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'

test('upgrade rewinds completed copies once, repairs missing tools and resumes idempotently', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'history-repair-'))
  const path = join(dir, 'test.db')
  let db = openDatabase(path)
  const rows = historyRows('dev-test', [
    { row_kind: 'message', role: 'user', row_id: 1, timestamp: 1, text: 'date' },
    { row_kind: 'message', role: 'tool', tool_call_id: 'call', timestamp: 2, name: 'terminal', context: 'date' },
    { row_kind: 'message', role: 'assistant', row_id: 4, timestamp: 3, text: 'done' }
  ])
  try {
    let store = new HistoryStore(db)
    store.session('bot', 'session', 1)
    store.write('bot', 'session', [rows[0], rows[2]], 'tail', true)
    store.discovered('bot')
    db.exec('ALTER TABLE bot_prefs DROP COLUMN pinned_at; ALTER TABLE bots DROP COLUMN reasoning_effort; PRAGMA user_version=18')
    db.close()
    db = openDatabase(path)
    store = new HistoryStore(db)
    expect(store.sessions('bot')[0]).toMatchObject({ cursor: null, complete: 0 })
    const reads: (string | null)[] = []
    const engine = {
      conversations: async () => ({
        list: async () => [{ id: 'session', at: 1 }],
        close() {},
        read: async (_id: string, cursor: string | null) => {
          reads.push(cursor)
          return { rows: cursor ? [] : rows, cursor: 'tail', empty: !!cursor, reset: false }
        }
      })
    } as unknown as BotEngine
    const service = new HistoryService(
      store,
      engine,
      async () => [{ id: 'bot', engineBotId: 'dev-test' }],
      () => true
    )
    await service.tick()
    service.close()
    db.close()
    db = openDatabase(path)
    store = new HistoryStore(db)
    expect(store.sessions('bot')[0].cursor).toBe('tail') // migration must not rewind every startup
    const restarted = new HistoryService(
      store,
      engine,
      async () => [{ id: 'bot', engineBotId: 'dev-test' }],
      () => true
    )
    await restarted.tick()
    await restarted.tick()
    expect(reads).toEqual([null, 'tail', 'tail'])
    expect(store.page('bot').items.map(r => r.id)).toEqual(rows.map(r => r.id))
    expect(store.progress('bot').complete).toBe(true)
    restarted.close()
  } finally {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
