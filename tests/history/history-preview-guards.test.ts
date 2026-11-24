/** Regression tests for savepoint failure isolation on preview writes and durable `last_turn_id` post-restart replay guards. */
import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'

const userEvent = (text: string, messageId: string = crypto.randomUUID()) => ({
  type: 'user.message' as const,
  messageId,
  text,
  attachments: [],
  images: { support: 'unknown' as const, imageCount: 0 }
})

describe('history preview savepoint isolation and durable last_turn_id replay guards', () => {
  test('dropped history_previews table never rolls back history_events, turn usage, or history_items', () => {
    const db = openDatabase(':memory:')
    const changed: string[] = []
    const store = new HistoryStore(db, botId => changed.push(botId))
    store.session('b1', 's1', 1000)
    db.exec('DROP TABLE history_previews;')

    // Event write commits history_events and turn usage even when history_previews is missing.
    expect(() => store.event('b1', 's1', userEvent('Must persist'))).not.toThrow()
    expect(() =>
      store.event('b1', 's1', {
        type: 'turn.finished',
        status: 'completed',
        text: 'Reply must persist',
        rowId: 'r1',
        usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 }
      })
    ).not.toThrow()
    expect(db.query('SELECT COUNT(*) AS n FROM history_events WHERE bot=?').get('b1')).toEqual({ n: 2 })
    expect(db.query('SELECT COUNT(*) AS n FROM history_turn_usage WHERE bot_id=?').get('b1')).toEqual({ n: 1 })

    // Backfill write commits history_items even when history_previews is missing.
    expect(() => store.write('b1', 's1', [{ id: 'r1', at: 1100, order: 0, item: { kind: 'assistant', text: 'Reply must persist' } }], 'c1', true)).not.toThrow()
    expect(db.query('SELECT COUNT(*) AS n FROM history_items WHERE bot=?').get('b1')).toEqual({ n: 1 })
    expect(changed).toEqual([])
    db.close()
  })

  test('aborting trigger on history_previews rolls back only the savepoint while outer event and item writes commit', () => {
    const db = openDatabase(':memory:')
    const changed: string[] = []
    const store = new HistoryStore(db, botId => changed.push(botId))
    store.session('b1', 's1', 1000)
    db.exec("CREATE TRIGGER fail_preview BEFORE INSERT ON history_previews BEGIN SELECT RAISE(ABORT, 'preview_boom'); END;")

    // Live event write: history_events commits, history_previews stays empty, onChanged not fired.
    expect(() => store.event('b1', 's1', userEvent('Owner message survives trigger'))).not.toThrow()
    expect(db.query('SELECT COUNT(*) AS n FROM history_events WHERE bot=?').get('b1')).toEqual({ n: 1 })
    expect(db.query('SELECT COUNT(*) AS n FROM history_previews WHERE bot=?').get('b1')).toEqual({ n: 0 })

    // Importer backfill write: history_items commits, history_previews stays empty, onChanged not fired.
    expect(() => store.write('b1', 's1', [{ id: 'i1', at: 1200, order: 0, item: { kind: 'assistant', text: 'Stored item survives trigger' } }], 'c1', true)).not.toThrow()
    expect(db.query('SELECT COUNT(*) AS n FROM history_items WHERE bot=?').get('b1')).toEqual({ n: 1 })
    expect(db.query('SELECT COUNT(*) AS n FROM history_previews WHERE bot=?').get('b1')).toEqual({ n: 0 })
    expect(changed).toEqual([])
    db.close()
  })

  test('N3b: persisted last_turn_id survives owner messages and restart so replaying an already-shown reply never overwrites a newer prompt', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    store.session('b1', 's1', 1000)

    // Turn 1 finishes (sets last_turn_id = 'r1'), imports into history_items, then owner sends Turn 2 (keeps last_turn_id = 'r1').
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'First reply', rowId: 'r1' }, 'live-uuid-1')
    store.write('b1', 's1', [{ id: 'r1', at: 1100, order: 0, item: { kind: 'assistant', text: 'First reply' } }])
    store.event('b1', 's1', userEvent('Second Q'), 'live-uuid-2')
    const beforeRestart = store.preview('b1')!
    expect(beforeRestart).toMatchObject({ from: 'user', text: 'Second Q' })
    expect(db.query('SELECT last_turn_id FROM history_previews WHERE bot=?').get('b1')).toEqual({ last_turn_id: 'r1' })

    // After restart (fresh HistoryStore, empty in-memory seenTurnIds), watchActivity replays r1 under a new event key.
    const changed: string[] = []
    const afterRestart = new HistoryStore(db, botId => changed.push(botId))
    afterRestart.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'First reply', rowId: 'r1' }, 'epoch1:5')
    expect(afterRestart.preview('b1')).toEqual(beforeRestart)
    expect(changed).toEqual([])
    db.close()
  })

  test('N3c: persisted last_turn_id from finished turn or bot-side backfill prevents post-restart replay from bumping at or pushing bots.changed', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)

    // Case 1: bot-side backfill seeds last_turn_id = 'hermes:b1:1' at historical timestamp at = 1000.
    store.session('b1', 's1', 1000)
    store.write('b1', 's1', [{ id: 'hermes:b1:1', at: 1000, order: 0, item: { kind: 'assistant', text: 'Backfilled reply' } }])
    expect(store.preview('b1')).toEqual({ from: 'bot', text: 'Backfilled reply', at: 1000 })
    expect(db.query('SELECT last_turn_id FROM history_previews WHERE bot=?').get('b1')).toEqual({ last_turn_id: 'hermes:b1:1' })

    // Post-restart replay of the same reply under a new key does not bump `at` or emit `onChanged`.
    const changed1: string[] = []
    const restarted1 = new HistoryStore(db, botId => changed1.push(botId))
    restarted1.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'Backfilled reply', rowId: 'hermes:b1:1' }, 'epoch1:9')
    expect(restarted1.preview('b1')).toEqual({ from: 'bot', text: 'Backfilled reply', at: 1000 })
    expect(changed1).toEqual([])

    // Case 2: live finished turn persisted with its timestamp; replay after restart does not bump `at` or emit `onChanged`.
    store.session('b2', 's2', 2000)
    store.event('b2', 's2', { type: 'turn.finished', status: 'completed', text: 'Live reply', rowId: 'r2' }, 'live-uuid-r2')
    const liveAt = store.preview('b2')!.at
    db.query('UPDATE history_previews SET at = ? WHERE bot = ?').run(liveAt - 5000, 'b2')
    const changed2: string[] = []
    const restarted2 = new HistoryStore(db, botId => changed2.push(botId))
    restarted2.event('b2', 's2', { type: 'turn.finished', status: 'completed', text: 'Live reply', rowId: 'r2' }, 'epoch2:3')
    expect(restarted2.preview('b2')).toEqual({ from: 'bot', text: 'Live reply', at: liveAt - 5000 })
    expect(changed2).toEqual([])
    db.close()
  })
})
