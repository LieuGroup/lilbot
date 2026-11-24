/** Regression tests for preview reconciliation across `history_items`, `history_events`, streaming deltas, failed turns, clock skew, and restarts. */
import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { HistoryStore } from '../../server/history/history-store'
import { startConformanceApp } from '../engines/conformance-fixture'

const userEvent = (text: string) => ({
  type: 'user.message' as const,
  messageId: crypto.randomUUID(),
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

    // Simulated server restart before history_items catches up: fresh cache must keep the newer event, not regress.
    const restarted = new HistoryStore(db)
    expect(restarted.preview('b1')).toEqual(live)
    db.close()
  })

  test('streaming deltas and failed turns in history_events never swamp or overwrite the preview after restart', () => {
    const db = openDatabase(':memory:')
    const store = new HistoryStore(db)
    store.event('b1', 's1', userEvent('First message on brand-new bot'))
    const expected = store.preview('b1')!
    expect(expected.text).toBe('First message on brand-new bot')

    // Write 50 streaming deltas + tool events + failed turns on top of history_events (well past any fixed 20-row window).
    for (let i = 0; i < 50; i++) store.event('b1', 's1', { type: 'text.delta', text: `chunk-${i} ` })
    store.event('b1', 's1', { type: 'tool.started', toolId: 't1', name: 'terminal', detail: 'ls' })
    store.event('b1', 's1', { type: 'tool.finished', toolId: 't1', failed: false })
    for (let i = 0; i < 8; i++) store.event('b1', 's1', { type: 'turn.finished', status: 'failed', text: `Provider HTTP 503 #${i}` })

    expect(store.preview('b1')).toEqual(expected)
    const restarted = new HistoryStore(db)
    expect(restarted.preview('b1')).toEqual(expected)
    db.close()
  })

  test('same-session older history_items write never clobbers an in-flight live message, and canonical write reconciles clock skew', () => {
    const db = openDatabase(':memory:')
    const changed: string[] = []
    const store = new HistoryStore(db, botId => changed.push(botId))
    store.session('b1', 's1', 1000)
    store.write('b1', 's1', [{ id: 'r1', at: 1000, order: 0, item: { kind: 'assistant', text: 'Old reply at t=1000' } }])
    changed.length = 0

    // Live user send in the SAME session `s1`.
    store.event('b1', 's1', userEvent('In-flight user message'))
    const live = store.preview('b1')!
    expect(live.from).toBe('user')
    expect(live.text).toBe('In-flight user message')
    expect(changed).toEqual(['b1'])

    // Background importer writes older `s1` rows before the engine persists the new turn: must not regress.
    changed.length = 0
    store.write('b1', 's1', [
      { id: 'r0', at: 500, order: 0, item: { kind: 'user', text: 'Ancient prompt' } },
      { id: 'r1', at: 1000, order: 1, item: { kind: 'assistant', text: 'Old reply at t=1000' } }
    ])
    expect(store.preview('b1')).toEqual(live)
    expect(changed).toEqual([])

    // Engine persists the same message with a canonical timestamp 412 ms behind LilBot's receipt clock:
    // canonical history_items row supersedes the matching live event both live and on restart.
    const canonicalAt = live.at - 412
    store.write('b1', 's1', [{ id: 'r2', at: canonicalAt, order: 2, item: { kind: 'user', text: 'In-flight user message' } }])
    expect(store.preview('b1')).toEqual({ from: 'user', text: 'In-flight user message', at: canonicalAt })
    expect(new HistoryStore(db).preview('b1')).toEqual({ from: 'user', text: 'In-flight user message', at: canonicalAt })
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
