/** Regression tests for preview reconciliation across `history_items`, `history_events`, streaming deltas, failed turns, clock skew, and restarts. */
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
  test('restart prefers a newer unimported event in history_events over an older history_items row', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    store.session('b1', 's1', 1000)
    store.write('b1', 's1', [{ id: 'r1', at: 1000, order: 0, item: { kind: 'assistant', text: 'Old reply at t=1000' } }])
    expect(store.preview('b1')).toEqual({ from: 'bot', text: 'Old reply at t=1000', at: 1000 })

    store.event('b1', 's1', userEvent('New urgent message'))
    const live = store.preview('b1')!
    expect(live.from).toBe('user')
    expect(live.text).toBe('New urgent message')

    expect(new HistoryStore(db).preview('b1')).toEqual(live)
    db.close()
  })

  test('streaming deltas and failed turns in history_events never swamp or overwrite the preview after restart', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    store.event('b1', 's1', userEvent('First message on brand-new bot'))
    const expected = store.preview('b1')!
    expect(expected.text).toBe('First message on brand-new bot')

    for (let i = 0; i < 50; i++) store.event('b1', 's1', { type: 'text.delta', text: `chunk-${i} ` })
    store.event('b1', 's1', { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'ls' })
    store.event('b1', 's1', { type: 'tool.finished', toolId: 't1', failed: false })
    for (let i = 0; i < 8; i++) store.event('b1', 's1', { type: 'turn.finished', status: 'failed', text: `Provider HTTP 503 #${i}` })

    expect(store.preview('b1')).toEqual(expected)
    expect(new HistoryStore(db).preview('b1')).toEqual(expected)
    db.close()
  })

  test('same-session older history_items write never clobbers an in-flight live message, and canonical write reconciles clock skew', () => {
    const db = openDatabase(':memory:')
    const changed: string[] = []
    const store = new HistoryStore(db, botId => changed.push(botId))
    store.session('b1', 's1', 1000)
    store.write('b1', 's1', [{ id: 'r1', at: 1000, order: 0, item: { kind: 'assistant', text: 'Old reply at t=1000' } }])
    changed.length = 0

    store.event('b1', 's1', userEvent('In-flight user message'))
    const live = store.preview('b1')!
    expect(live.from).toBe('user')
    expect(live.text).toBe('In-flight user message')
    expect(changed).toEqual(['b1'])

    changed.length = 0
    store.write('b1', 's1', [
      { id: 'r0', at: 500, order: 0, item: { kind: 'user', text: 'Ancient prompt' } },
      { id: 'r1', at: 1000, order: 1, item: { kind: 'assistant', text: 'Old reply at t=1000' } }
    ])
    expect(store.preview('b1')).toEqual(live)
    expect(changed).toEqual([])

    const canonicalAt = live.at - 412
    store.write('b1', 's1', [{ id: 'r2', at: canonicalAt, order: 2, item: { kind: 'user', text: 'In-flight user message' } }])
    expect(store.preview('b1')).toEqual({ from: 'user', text: 'In-flight user message', at: canonicalAt })
    expect(new HistoryStore(db).preview('b1')).toEqual({ from: 'user', text: 'In-flight user message', at: canonicalAt })
    db.close()
  })

  test('stored order wins when an older turn.finished arrives late after turn 2 is stored (Case 1, live and restart)', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    const now = Date.now()
    store.session('b1', 's1', now - 1000)
    store.write('b1', 's1', [
      { id: 'r1', at: now - 412, order: 0, item: { kind: 'assistant', text: 'Turn 1 reply' } },
      { id: 'r2', at: now - 112, order: 1, item: { kind: 'user', text: 'Turn 2 follow-up' } }
    ])
    expect(store.preview('b1')).toEqual({ from: 'user', text: 'Turn 2 follow-up', at: now - 112 })

    // Late turn.finished for Turn 1 arrives at `now` (412 ms behind receipt clock, ahead of Turn 2's stored time).
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'Turn 1 reply' })
    expect(store.preview('b1')).toEqual({ from: 'user', text: 'Turn 2 follow-up', at: now - 112 })
    expect(new HistoryStore(db).preview('b1')).toEqual({ from: 'user', text: 'Turn 2 follow-up', at: now - 112 })
    db.close()
  })

  test('stored bot answer with trailing timestamp supersedes earlier owner event live and after restart (Case 2)', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    store.session('b1', 's1', Date.now() - 1000)

    store.event('b1', 's1', userEvent('Ask'))
    const liveAt = store.preview('b1')!.at
    expect(store.preview('b1')?.text).toBe('Ask')

    // Stored timestamps trail receipt clock by 500 ms and 200 ms, and turn.finished was never delivered.
    store.write('b1', 's1', [
      { id: 'r1', at: liveAt - 500, order: 0, item: { kind: 'user', text: 'Ask' } },
      { id: 'r2', at: liveAt - 200, order: 1, item: { kind: 'assistant', text: 'Answer' } }
    ])
    expect(store.preview('b1')).toEqual({ from: 'bot', text: 'Answer', at: liveAt - 200 })
    expect(new HistoryStore(db).preview('b1')).toEqual({ from: 'bot', text: 'Answer', at: liveAt - 200 })
    db.close()
  })

  test('older-session late events never beat a newer session, and repeated user text with distinct messageId advances', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    const now = Date.now()
    store.session('b1', 's1', now - 2000)
    store.session('b1', 's2', now - 500)
    store.write('b1', 's2', [
      { id: 'r1', at: now - 400, order: 0, item: { kind: 'user', text: 'ok', messageId: 'm1' } },
      { id: 'r2', at: now - 300, order: 1, item: { kind: 'assistant', text: 'Done 1' } }
    ])

    // Late event from older session s1 must not overwrite newer session s2.
    store.event('b1', 's1', { type: 'turn.finished', status: 'completed', text: 'Late from s1' })
    expect(store.preview('b1')).toEqual({ from: 'bot', text: 'Done 1', at: now - 300 })
    expect(new HistoryStore(db).preview('b1')).toEqual({ from: 'bot', text: 'Done 1', at: now - 300 })

    // A second identical "ok" with a new messageId in s2 is NOT falsely treated as superseded by m1.
    store.event('b1', 's2', userEvent('ok', 'm2'))
    expect(store.preview('b1')?.from).toBe('user')
    expect(store.preview('b1')?.text).toBe('ok')
    expect(new HistoryStore(db).preview('b1')?.text).toBe('ok')
    db.close()
  })

  test('failed engine turn never leaks error text into roster lastMessage', async () => {
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
      expect(afterFail?.from).toBe('user')
      expect(afterFail?.text).toBe('trigger-fail')
      expect(afterFail?.text).not.toContain('503')
      chat.close()
    } finally {
      app.close()
    }
  })
})
