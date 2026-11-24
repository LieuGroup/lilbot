/** Regression tests for preview reconciliation (rowid watermarks + exact IDs, zero text-window matching) and fault-tolerant async warming. */
import { describe, expect, test } from 'bun:test'
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

describe('history preview reconciliation and restart recovery', () => {
  test('restart mid-turn, delta flooding behind 50 deltas, and same-session in-flight writes stay consistent', () => {
    const db = openDatabase(':memory:')
    const changed: string[] = []
    const store = new HistoryStore(db, botId => changed.push(botId))

    // R1 + R3: restart mid-turn & same-session older write never clobber an in-flight live message.
    store.session('b1', 's1', 1000)
    store.write('b1', 's1', [{ id: 'r1', at: 1000, order: 0, item: { kind: 'assistant', text: 'Old reply at t=1000' } }])
    changed.length = 0
    store.event('b1', 's1', userEvent('In-flight urgent message'))
    const live = store.preview('b1')!
    expect(live).toMatchObject({ from: 'user', text: 'In-flight urgent message' })
    expect(changed).toEqual(['b1'])
    expect(new HistoryStore(db).preview('b1')).toEqual(live)

    changed.length = 0
    store.write('b1', 's1', [
      { id: 'r0', at: 500, order: 0, item: { kind: 'user', text: 'Ancient prompt' } },
      { id: 'r1', at: 1000, order: 1, item: { kind: 'assistant', text: 'Old reply at t=1000' } }
    ])
    expect(store.preview('b1')).toEqual(live)
    expect(new HistoryStore(db).preview('b1')).toEqual(live)
    expect(changed).toEqual([])

    // Canonical write advances watermark and settles to stored timestamp.
    const canonicalAt = live.at - 412
    store.write('b1', 's1', [{ id: 'r2', at: canonicalAt, order: 2, item: { kind: 'user', text: 'In-flight urgent message' } }])
    expect(store.preview('b1')).toEqual({ from: 'user', text: 'In-flight urgent message', at: canonicalAt })
    expect(new HistoryStore(db).preview('b1')).toEqual({ from: 'user', text: 'In-flight urgent message', at: canonicalAt })

    // R2: brand-new bot behind 50 streaming deltas and 8 failed turns keeps first message after restart.
    store.event('b2', 's2', userEvent('First message on brand-new bot'))
    const first = store.preview('b2')!
    for (let i = 0; i < 50; i++) store.event('b2', 's2', { type: 'text.delta', text: `chunk-${i} ` })
    store.event('b2', 's2', { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'ls' })
    store.event('b2', 's2', { type: 'tool.finished', toolId: 't1', failed: false })
    for (let i = 0; i < 8; i++) store.event('b2', 's2', { type: 'turn.finished', status: 'failed', text: `Provider HTTP 503 #${i}` })
    expect(store.preview('b2')).toEqual(first)
    expect(new HistoryStore(db).preview('b2')).toEqual(first)
    db.close()
  })

  test('Case 1 (late turn.finished by rowId or before write), Case 2 (trailing stored bot answer), and older-session late events', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    const now = Date.now()

    // Case 1: late turn.finished carrying stored rowId `r1` after Turn 2 is stored never reverts preview.
    store.session('b1', 's1', now - 1000)
    store.write('b1', 's1', [
      { id: 'r1', at: now - 412, order: 0, item: { kind: 'assistant', text: 'Turn 1 reply' } },
      { id: 'r2', at: now - 112, order: 1, item: { kind: 'user', text: 'Turn 2 follow-up' } }
    ])
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'Turn 1 reply', rowId: 'r1' })
    expect(store.preview('b1')).toEqual({ from: 'user', text: 'Turn 2 follow-up', at: now - 112 })
    expect(new HistoryStore(db).preview('b1')).toEqual({ from: 'user', text: 'Turn 2 follow-up', at: now - 112 })

    // Case 2: owner sends "Ask", then stored [Ask @ -500ms, Answer @ -200ms] advances to Answer live and on restart.
    store.session('b2', 's1', now - 1000)
    store.event('b2', 's1', userEvent('Ask'))
    const askAt = store.preview('b2')!.at
    store.write('b2', 's1', [
      { id: 'r1', at: askAt - 500, order: 0, item: { kind: 'user', text: 'Ask' } },
      { id: 'r2', at: askAt - 200, order: 1, item: { kind: 'assistant', text: 'Answer' } }
    ])
    expect(store.preview('b2')).toEqual({ from: 'bot', text: 'Answer', at: askAt - 200 })
    expect(new HistoryStore(db).preview('b2')).toEqual({ from: 'bot', text: 'Answer', at: askAt - 200 })

    // Older-session late event never overwrites a newer session.
    store.session('b3', 's1', now - 2000)
    store.session('b3', 's2', now - 500)
    store.write('b3', 's2', [{ id: 'r2', at: now - 300, order: 0, item: { kind: 'assistant', text: 'Done in s2' } }])
    store.event('b3', 's1', { type: 'turn.finished', status: 'completed', text: 'Late from s1' })
    expect(store.preview('b3')).toEqual({ from: 'bot', text: 'Done in s2', at: now - 300 })
    expect(new HistoryStore(db).preview('b3')).toEqual({ from: 'bot', text: 'Done in s2', at: now - 300 })
    db.close()
  })

  test('repeated identical messages within 10s always advance (1A distinct rowId, 1B Hermes plain user row, 1C no id)', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    const now = Date.now()

    // 1A: repeated identical bot reply "Done." with distinct rowId (`hermes:bA:3` vs `hermes:bA:1`).
    store.session('bA', 's1', now - 5000)
    store.write('bA', 's1', [
      { id: 'hermes:bA:1', at: now - 3000, order: 0, item: { kind: 'assistant', text: 'Done.' } },
      { id: 'hermes:bA:2', at: now - 1000, order: 1, item: { kind: 'user', text: 'Run it again' } }
    ])
    store.event('bA', 's1', { type: 'turn.finished', status: 'completed', text: 'Done.', rowId: 'hermes:bA:3' })
    expect(store.preview('bA')).toMatchObject({ from: 'bot', text: 'Done.' })
    expect(new HistoryStore(db).preview('bA')).toMatchObject({ from: 'bot', text: 'Done.' })

    // 1B: repeated owner "ok" where stored Hermes row has NO messageId.
    store.session('bB', 's1', now - 5000)
    store.write('bB', 's1', [
      { id: 'hermes:bB:1', at: now - 3000, order: 0, item: { kind: 'user', text: 'ok' } },
      { id: 'hermes:bB:2', at: now - 1000, order: 1, item: { kind: 'assistant', text: 'What next?' } }
    ])
    store.event('bB', 's1', userEvent('ok', 'new-msg-2'))
    expect(store.preview('bB')).toMatchObject({ from: 'user', text: 'ok' })
    expect(new HistoryStore(db).preview('bB')).toMatchObject({ from: 'user', text: 'ok' })

    // 1C: repeated message "yes" with NO id on either stored row or event.
    store.session('bC', 's1', now - 5000)
    store.write('bC', 's1', [
      { id: 'r1', at: now - 3000, order: 0, item: { kind: 'user', text: 'yes' } },
      { id: 'r2', at: now - 1000, order: 1, item: { kind: 'assistant', text: 'Proceed?' } }
    ])
    store.event('bC', 's1', { type: 'user.message', messageId: '', text: 'yes', attachments: [], images: { support: 'unknown', imageCount: 0 } })
    expect(store.preview('bC')).toMatchObject({ from: 'user', text: 'yes' })
    expect(new HistoryStore(db).preview('bC')).toMatchObject({ from: 'user', text: 'yes' })
    db.close()
  })

  test('async bounded warming yields, isolates DB errors without aborting startup, and failed turns never leak error text', async () => {
    // Broken DB table during warmPreviewsAsync never throws and lazy preview returns undefined safely.
    const broken = openDatabase(':memory:')
    broken.exec('DROP TABLE history_sessions;')
    const brokenStore = new HistoryStore(broken)
    await expect(brokenStore.warmPreviewsAsync(['b1', 'b2'], 1)).resolves.toBeUndefined()
    await expect(
      brokenStore.warmPreviewsAsync(() => {
        throw new Error('boom')
      })
    ).resolves.toBeUndefined()
    expect(brokenStore.preview('b1')).toBeUndefined()
    broken.close()

    // Chunked warming on healthy DB runs asynchronously (does not populate synchronously) and seeds all bots.
    const healthy = openDatabase(':memory:')
    const hs = new HistoryStore(healthy)
    for (let i = 0; i < 7; i++) {
      hs.session(`b${i}`, 's1', 1000)
      hs.write(`b${i}`, 's1', [{ id: `r${i}`, at: 1000, order: 0, item: { kind: 'assistant', text: `Msg ${i}` } }])
    }
    const fresh = new HistoryStore(healthy)
    const warmPromise = fresh.warmPreviewsAsync(
      Array.from({ length: 7 }, (_, i) => `b${i}`),
      2
    )
    await warmPromise
    expect(fresh.preview('b6')?.text).toBe('Msg 6')
    healthy.close()

    // Failed engine turn never leaks provider error text into roster lastMessage.
    const app = await startConformanceApp()
    try {
      const bot = await app.services.bots.createBot({ name: 'Alpha', function: '', instructions: '' })
      await app.services.bots.prepareRuntimes()
      app.engine.setTurnHandler(async ctx => {
        if (ctx.input.text === 'trigger-fail') throw new Error('Provider HTTP 503 overloaded')
        return 'Healthy reply'
      })
      const chat = await app.services.bots.openChat(bot.id, undefined, () => {})
      await chat.send('First')
      expect((await app.services.bots.listBots()).find(b => b.id === bot.id)?.lastMessage?.text).toBe('Healthy reply')
      await chat.send('trigger-fail')
      const afterFail = (await app.services.bots.listBots()).find(b => b.id === bot.id)?.lastMessage
      expect(afterFail).toMatchObject({ from: 'user', text: 'trigger-fail' })
      chat.close()
    } finally {
      app.close()
    }
  })
})
