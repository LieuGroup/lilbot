/** Regression tests for single-row `history_previews`: restart/delta survival, importer isolation (A1/A2/A3b/A6), session ordering (A4), replays, atomicity, and fault isolation. */
import { describe, expect, test } from 'bun:test'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'
import { startConformanceApp } from '../engines/conformance-fixture'

const userEvent = (text: string, messageId: string = crypto.randomUUID()) => ({
  type: 'user.message' as const,
  messageId,
  text,
  attachments: [],
  images: { support: 'unknown' as const, imageCount: 0 }
})
const doneEvent = (text: string, rowId?: string, status: 'completed' | 'stopped' | 'failed' = 'completed') => ({
  type: 'turn.finished' as const,
  status,
  text,
  ...(rowId ? { rowId } : {})
})

describe('history preview durability, importer isolation, and session ordering', () => {
  test('R1/R2/R3/A5: restart mid-turn, 50 deltas, stopped turns, and one-time upgrade backfill', () => {
    const db = openDatabase(':memory:')
    const changed: string[] = []
    const store = new HistoryStore(db, botId => changed.push(botId))

    // Backfill once when empty, then live event updates atomically and survives restart + older writes.
    store.session('b1', 's1', 1000)
    store.write('b1', 's1', [{ id: 'r1', at: 1000, order: 0, item: { kind: 'assistant', text: 'Old reply' } }])
    expect(store.preview('b1')).toEqual({ from: 'bot', text: 'Old reply', at: 1000 })
    changed.length = 0
    store.event('b1', 's1', userEvent('In-flight urgent message'))
    const live = store.preview('b1')!
    expect(live).toMatchObject({ from: 'user', text: 'In-flight urgent message' })
    expect(changed).toEqual(['b1'])
    expect(new HistoryStore(db).preview('b1')).toEqual(live)

    // Importer writes never overwrite an existing preview row.
    changed.length = 0
    store.write('b1', 's1', [{ id: 'r0', at: 500, order: 0, item: { kind: 'user', text: 'Ancient prompt' } }])
    expect(store.preview('b1')).toEqual(live)
    expect(changed).toEqual([])

    // R2 + A5: brand-new bot behind 50 deltas, tools, failed turns, and empty stop keeps first message; partial stop updates.
    store.event('b2', 's2', userEvent('Long task'))
    const first = store.preview('b2')!
    for (let i = 0; i < 50; i++) store.event('b2', 's2', { type: 'text.delta', text: `chunk-${i} ` })
    store.event('b2', 's2', { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'ls' })
    store.event('b2', 's2', { type: 'tool.finished', toolId: 't1', failed: false })
    for (let i = 0; i < 8; i++) store.event('b2', 's2', doneEvent(`HTTP 503 #${i}`, undefined, 'failed'))
    store.event('b2', 's2', doneEvent('', undefined, 'stopped'))
    expect(store.preview('b2')).toEqual(first)
    expect(new HistoryStore(db).preview('b2')).toEqual(first)
    store.event('b2', 's2', doneEvent('Partial work before stop', undefined, 'stopped'))
    expect(store.preview('b2')).toMatchObject({ from: 'bot', text: 'Partial work before stop' })

    // Upgrade backfill: pre-existing history_items with empty history_previews populates history_previews once and persists.
    const itemJson = JSON.stringify({ kind: 'assistant', text: 'Pre-upgrade message' })
    db.query('INSERT INTO history_sessions(bot,id,at,complete) VALUES(?,?,?,1)').run('b3', 's3', 2000)
    db.query('INSERT INTO history_items(bot,session,id,at,position,item,text) VALUES(?,?,?,?,?,?,?)').run('b3', 's3', 'up-1', 2000, 0, itemJson, 'Pre-upgrade message')
    expect(new HistoryStore(db).preview('b3')).toEqual({ from: 'bot', text: 'Pre-upgrade message', at: 2000 })
    expect(db.query('SELECT text, session FROM history_previews WHERE bot=?').get('b3')).toEqual({ text: 'Pre-upgrade message', session: 's3' })
    db.close()
  })

  test('A1/A2/A3b/A6: concurrent fast turns, incomplete oldest-first pages, and two-device sends never regress preview', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)

    // A2: concurrent fast turn (user "ok" + bot "All set" rowId r1) followed by importer write [plain user, r1].
    store.session('a2', 's1', 1000)
    store.write('a2', 's1', [{ id: 'r0', at: 1000, order: 0, item: { kind: 'assistant', text: 'Earlier' } }])
    store.event('a2', 's1', userEvent('ok'))
    store.event('a2', 's1', { type: 'turn.finished', status: 'completed', text: 'All set', rowId: 'r1' })
    store.write('a2', 's1', [
      { id: 'u1', at: 1100, order: 1, item: { kind: 'user', text: 'ok' } },
      { id: 'r1', at: 1200, order: 2, item: { kind: 'assistant', text: 'All set' } }
    ])
    expect(store.preview('a2')).toMatchObject({ from: 'bot', text: 'All set' })
    expect(new HistoryStore(db).preview('a2')).toMatchObject({ from: 'bot', text: 'All set' })

    // A3b: live event on a long session followed by an incomplete oldest-first Page 1 import (`complete = false`).
    store.session('a3', 's1', 1000)
    store.event('a3', 's1', userEvent('Deploy now'))
    store.write('a3', 's1', [{ id: 'p1-100', at: 1050, order: 99, item: { kind: 'assistant', text: 'Old page 1 row' } }], 'c1', false)
    expect(store.preview('a3')).toMatchObject({ from: 'user', text: 'Deploy now' })
    expect(new HistoryStore(db).preview('a3')).toMatchObject({ from: 'user', text: 'Deploy now' })

    // A6: two devices send concurrently while importer writes only Device A's plain user row.
    store.session('a6', 's1', 1000)
    store.event('a6', 's1', userEvent('From laptop'))
    store.event('a6', 's1', userEvent('From phone'))
    store.write('a6', 's1', [{ id: 'uA', at: 1100, order: 0, item: { kind: 'user', text: 'From laptop' } }], 'cA', true)
    expect(store.preview('a6')).toMatchObject({ from: 'user', text: 'From phone' })
    expect(new HistoryStore(db).preview('a6')).toMatchObject({ from: 'user', text: 'From phone' })
    db.close()
  })

  test('A4 (new session mid-turn), Case 1 (late turn.finished replays), and 1A/1B/1C repeated messages', () => {
    const db = openDatabase(':memory:')
    const prefs = new BotPrefsStore(db)
    const store = new HistoryStore(db)
    const now = Date.now()

    // A4 with bot_prefs.main_chat_id (both before and after S2 sends a message).
    store.session('a4m', 's1', 1000)
    prefs.setMainChat('a4m', 's1')
    store.event('a4m', 's1', userEvent('Old S1 prompt'))
    store.session('a4m', 's2', 2000)
    prefs.setMainChat('a4m', 's2')
    store.event('a4m', 's1', { type: 'turn.finished', status: 'completed', text: 'Late S1 before S2 send' })
    expect(store.preview('a4m')).toMatchObject({ from: 'user', text: 'Old S1 prompt' })
    store.event('a4m', 's2', userEvent('Fresh S2 question'))
    store.event('a4m', 's1', { type: 'turn.finished', status: 'completed', text: 'Stale S1 late reply' })
    expect(store.preview('a4m')).toMatchObject({ from: 'user', text: 'Fresh S2 question' })
    expect(new HistoryStore(db).preview('a4m')).toMatchObject({ from: 'user', text: 'Fresh S2 question' })

    // A4 without bot_prefs (session order alone): late s1 reply cannot overwrite s2 live message.
    store.session('a4s', 's1', 1000)
    store.write('a4s', 's1', [{ id: 'r0', at: 1000, order: 0, item: { kind: 'assistant', text: 'S1 reply' } }])
    store.session('a4s', 's2', 2000)
    store.event('a4s', 's2', userEvent('Fresh S2 without prefs'))
    store.event('a4s', 's1', { type: 'turn.finished', status: 'completed', text: 'Late S1 reply' })
    expect(store.preview('a4s')).toMatchObject({ from: 'user', text: 'Fresh S2 without prefs' })
    expect(new HistoryStore(db).preview('a4s')).toMatchObject({ from: 'user', text: 'Fresh S2 without prefs' })

    // Case 1: late turn.finished for stored rowId `r1` behind Turn 2 never reverts preview; same-process duplicate replay also skipped.
    store.session('c1', 's1', now - 1000)
    store.write('c1', 's1', [
      { id: 'r1', at: now - 400, order: 0, item: { kind: 'assistant', text: 'Turn 1 reply' } },
      { id: 'r2', at: now - 100, order: 1, item: { kind: 'user', text: 'Turn 2 follow-up' } }
    ])
    store.event('c1', 's1', { type: 'turn.finished', status: 'completed', text: 'Turn 1 reply', rowId: 'r1' })
    expect(store.preview('c1')).toEqual({ from: 'user', text: 'Turn 2 follow-up', at: now - 100 })
    store.event('c1b', 's1', { type: 'turn.finished', status: 'completed', text: 'T1', rowId: 'live-1' })
    store.event('c1b', 's1', userEvent('T2'))
    store.event('c1b', 's1', { type: 'turn.finished', status: 'completed', text: 'T1', rowId: 'live-1' })
    expect(store.preview('c1b')).toMatchObject({ from: 'user', text: 'T2' })
    // Positive counterpart: if tick() imported r1 as the newest row 5ms before turn.finished(r1), turn.finished still advances.
    store.session('c1c', 's1', now - 1000)
    store.event('c1c', 's1', userEvent('Prompt'))
    store.write('c1c', 's1', [{ id: 'r1', at: now - 10, order: 0, item: { kind: 'assistant', text: 'Fast reply' } }])
    store.event('c1c', 's1', { type: 'turn.finished', status: 'completed', text: 'Fast reply', rowId: 'r1' })
    expect(store.preview('c1c')).toMatchObject({ from: 'bot', text: 'Fast reply' })

    // 1A/1B/1C: repeated identical messages within 10s always advance (distinct rowId, plain Hermes row, no id).
    store.session('bA', 's1', now - 5000)
    store.write('bA', 's1', [
      { id: 'hermes:bA:1', at: now - 3000, order: 0, item: { kind: 'assistant', text: 'Done.' } },
      { id: 'hermes:bA:2', at: now - 1000, order: 1, item: { kind: 'user', text: 'Run it again' } }
    ])
    store.event('bA', 's1', { type: 'turn.finished', status: 'completed', text: 'Done.', rowId: 'hermes:bA:3' })
    expect(store.preview('bA')).toMatchObject({ from: 'bot', text: 'Done.' })
    store.event('bB', 's1', userEvent('ok', 'm1'))
    store.event('bB', 's1', { type: 'turn.finished', status: 'completed', text: 'What next?' })
    store.event('bB', 's1', { type: 'user.message', messageId: '', text: 'ok', attachments: [], images: { support: 'unknown', imageCount: 0 } })
    expect(store.preview('bB')).toMatchObject({ from: 'user', text: 'ok' })
    db.close()
  })

  test('A7 atomicity, broken-DB fault isolation, and failed engine turn error suppression', async () => {
    // A7: aborting inside history_previews rolls back history_events atomically and never emits onChanged.
    const atomicDb = openDatabase(':memory:')
    const changed: string[] = []
    const atomicStore = new HistoryStore(atomicDb, botId => changed.push(botId))
    atomicDb.exec("CREATE TRIGGER fail_preview BEFORE INSERT ON history_previews BEGIN SELECT RAISE(ABORT, 'preview_boom'); END;")
    expect(() => atomicStore.event('b1', 's1', userEvent('Should roll back'))).toThrow('preview_boom')
    expect(atomicDb.query('SELECT COUNT(*) AS n FROM history_events').get()).toEqual({ n: 0 })
    expect(atomicDb.query('SELECT COUNT(*) AS n FROM history_previews').get()).toEqual({ n: 0 })
    expect(changed).toEqual([])
    atomicDb.close()

    // Broken DB table never throws on preview() or previewsFor().
    const broken = openDatabase(':memory:')
    broken.exec('DROP TABLE history_previews;')
    const brokenStore = new HistoryStore(broken)
    expect(brokenStore.preview('b1')).toBeUndefined()
    expect(brokenStore.previewsFor(['b1', 'b2']).size).toBe(0)
    broken.close()

    // Failed engine turn never leaks provider error text into roster lastMessage.
    const app = await startConformanceApp()
    try {
      const bot = await app.services.bots.createBot({ name: 'Alpha', function: '', instructions: '' })
      await app.services.bots.prepareRuntimes()
      app.engine.setTurnHandler(async ctx => (ctx.input.text === 'trigger-fail' ? Promise.reject(new Error('Provider HTTP 503 overloaded')) : 'Healthy reply'))
      const chat = await app.services.bots.openChat(bot.id, undefined, () => {})
      await chat.send('hello')
      expect((await app.services.bots.listBots()).find(b => b.id === bot.id)?.lastMessage?.text).toBe('Healthy reply')
      await chat.send('trigger-fail')
      const afterFail = (await app.services.bots.listBots()).find(b => b.id === bot.id)?.lastMessage
      expect(afterFail).toMatchObject({ from: 'user', text: 'trigger-fail' })
      expect(afterFail?.text).not.toContain('503')
      chat.close()
    } finally {
      app.close()
    }
  })
})
