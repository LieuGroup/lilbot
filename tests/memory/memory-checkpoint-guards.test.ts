import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { memoryHandlers } from '../../server/http/memory-handlers'
import { type Evidence, MemoryCheckpoint } from '../../server/memory/memory-checkpoint'
import { findStoppedTurn, pieceTiming } from '../../server/memory/memory-checkpoint-meta'
import { type CheckpointChoiceAudit, MemoryCheckpointRefusalStore } from '../../server/memory/memory-checkpoint-refusals'
import { MemoryCheckpointStore } from '../../server/memory/memory-checkpoint-store'
import { LilBotError } from '../../shared/lilbot-error'

function makeDb() {
  const db = openDatabase(':memory:')
  const store = new MemoryCheckpointStore(db)
  let changed = 0
  const audits: CheckpointChoiceAudit[] = []
  let clock = 1_700_000_000_000
  const refusals = new MemoryCheckpointRefusalStore(
    db,
    store,
    () => changed++,
    audit => audits.push(audit),
    () => (clock += 1000)
  )
  return { db, store, refusals, audits, getChanged: () => changed }
}

describe('PR #300 regressions and guard mutation killers', () => {
  test('Fix #1: provider_policy_blocked fails as ordinary review_failed naming the cause — zero fallback, splitting, or card', async () => {
    const f = makeDb()
    const calls: boolean[] = []
    const checkpoint = new MemoryCheckpoint(
      async (_b, _p, opts) => {
        calls.push(Boolean(opts?.useBotModel))
        throw new LilBotError('review_failed', 'The memory review failed because the provider blocked the request under account data-policy settings (provider_policy_blocked).')
      },
      f.store,
      () => '',
      {
        hasFallbackModel: () => true,
        canAskOwner: () => true,
        recordRefusal: (b, c, k, ks, e, ctx) => f.refusals.recordRefusal(b, c, k, ks, e, ctx),
        clearPending: (b, c, k) => f.refusals.clearPending(b, c, k)
      }
    )
    const evidence: Evidence[] = Array.from({ length: 8 }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', text: `Normal message ${i}` }))
    await expect(checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({
      code: 'review_failed',
      message: expect.stringContaining('provider_policy_blocked')
    })
    expect(calls).toEqual([false])
    expect(f.refusals.pending('b1', 'c1')).toBeNull()
    expect(f.db.query<{ n: number }, []>('SELECT count(*) AS n FROM memory_checkpoint_refusals').get()!.n).toBe(0)
    f.db.close()
  })

  test('Fix #2: findStoppedTurn collapses dual-path openChat + watchActivity records by durable turn identity and still rejects distinct turns or side effects', () => {
    const db = openDatabase(':memory:')
    const insertEv = (chat: string, ev: unknown, at: number, key: string = crypto.randomUUID()) =>
      db.query('INSERT INTO history_events(bot, session, at, event, key) VALUES (?, ?, ?, ?, ?)').run('b1', chat, at, JSON.stringify(ev), key)

    // Interleaved dual-path without rowId (live Hermes preflight failure): openChat (UUID) + watchActivity (epoch:seq).
    insertEv('c-dual', { type: 'user.message', messageId: 'm1', text: 'Continue deployment', attachments: [], origin: { deviceId: 'dev-1', name: 'Mac' } }, 1000)
    insertEv('c-dual', { type: 'turn.started' }, 1001)
    insertEv('c-dual', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' }, 1002)
    insertEv('c-dual', { type: 'turn.started' }, 1003, '1:41')
    insertEv('c-dual', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' }, 1004, '1:42')
    expect(findStoppedTurn(db, 'b1', 'c-dual')).toEqual({ kind: 'stopped', text: 'Continue deployment', attachmentIds: [], deviceId: 'dev-1' })

    // Dual-path WITH identical durable rowId collapses cleanly.
    insertEv('c-rowid', { type: 'user.message', messageId: 'm2', text: 'Summarize notes', attachments: [] }, 2000)
    insertEv('c-rowid', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save', rowId: 'hermes:b1:99' }, 2001)
    insertEv('c-rowid', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save', rowId: 'hermes:b1:99' }, 2002, '1:50')
    expect(findStoppedTurn(db, 'b1', 'c-rowid')).toEqual({ kind: 'stopped', text: 'Summarize notes', attachmentIds: [] })

    // Two DIFFERENT durable rowIds on the tail do NOT collapse (distinct turns -> unsafe).
    insertEv('c-diff', { type: 'user.message', messageId: 'm3', text: 'Two turns', attachments: [] }, 3000)
    insertEv('c-diff', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save', rowId: 'hermes:b1:98' }, 3001)
    insertEv('c-diff', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save', rowId: 'hermes:b1:99' }, 3002, '1:51')
    expect(findStoppedTurn(db, 'b1', 'c-diff')).toEqual({ kind: 'unsafe' })

    // Dual-path where a tool ran before memory_save still fails closed as unsafe.
    insertEv('c-tool', { type: 'user.message', messageId: 'm4', text: 'Run task', attachments: [] }, 4000)
    insertEv('c-tool', { type: 'tool.started', toolId: 't1', name: 'shell', detail: 'ls' }, 4001)
    insertEv('c-tool', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' }, 4002)
    insertEv('c-tool', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' }, 4003, '1:52')
    expect(findStoppedTurn(db, 'b1', 'c-tool')).toEqual({ kind: 'unsafe' })
    db.close()
  })

  test('Fix #3: pieceTiming resolves recent unimported history_events and repeated short messages by stored position, never text matching', () => {
    const db = openDatabase(':memory:')
    const t1 = new Date(2026, 10, 25, 13, 0, 0).getTime()
    const t2 = new Date(2026, 10, 25, 13, 1, 0).getTime()
    const t3 = new Date(2026, 10, 25, 15, 0, 0).getTime()
    const t4 = new Date(2026, 10, 25, 15, 1, 0).getTime()

    const addItem = (id: string, at: number, pos: number, item: Record<string, unknown>, text: string) =>
      db.query('INSERT INTO history_items(bot, session, id, at, position, item, text) VALUES (?, ?, ?, ?, ?, ?, ?)').run('b1', 'c1', id, at, pos, JSON.stringify(item), text)
    const addEv = (at: number, ev: unknown, key: string = crypto.randomUUID()) =>
      db.query('INSERT INTO history_events(bot, session, at, event, key) VALUES (?, ?, ?, ?, ?)').run('b1', 'c1', at, JSON.stringify(ev), key)
    addItem('hermes:b1:1', t1, 1, { kind: 'user', text: 'ok', messageId: 'm-old' }, 'ok')
    addItem('hermes:b1:2', t2, 2, { kind: 'assistant', text: 'Old reply' }, 'Old reply')
    addEv(t1, { type: 'user.message', messageId: 'm-old', text: 'ok', attachments: [] })
    addEv(t2, { type: 'turn.finished', status: 'completed', text: 'Old reply', rowId: 'hermes:b1:2' })
    addEv(t2 + 5, { type: 'turn.finished', status: 'completed', text: 'Old reply', rowId: 'hermes:b1:2' }, '1:2')
    addEv(t3, { type: 'user.message', messageId: 'm-new', text: 'ok', attachments: [] })
    addEv(t4, { type: 'turn.finished', status: 'completed', text: 'Unique unimported reply', rowId: 'hermes:b1:4' })

    expect(pieceTiming(db, 'b1', 'c1', [{ role: 'user', messageIndex: 2 }], 4, 'assistant')).toEqual({ singleMessage: true, pieceAt: t3, messagesBack: 2 })
    expect(pieceTiming(db, 'b1', 'c1', [{ role: 'assistant', messageIndex: 3 }], 4, 'assistant')).toEqual({ singleMessage: true, pieceAt: t4, messagesBack: 1 })
    expect(pieceTiming(db, 'b1', 'c1', [{ role: 'user', messageIndex: 0 }], 4, 'assistant')).toEqual({ singleMessage: true, pieceAt: t1, messagesBack: 4 })
    db.close()
  })

  test('Fix #4 (M3, M5, M7): enforces 2-refusal threshold, eligibleForChoice gate, and waiting-only choose guard', () => {
    const f = makeDb()
    // M3: first refusal stays in counting (waiting: false, pending: null); second refusal opens waiting.
    expect(f.refusals.recordRefusal('b1', 'c1', 'k1', ['k1'], true)).toEqual({ refusalCount: 1, waiting: false })
    expect(f.refusals.pending('b1', 'c1')).toBeNull()
    expect(f.getChanged()).toBe(0)

    // M7: choose() while still in counting MUST be refused without skipping or auditing.
    expect(() => f.refusals.choose('b1', 'c1', 'k1', 'skip_piece')).toThrow(LilBotError)
    try {
      f.refusals.choose('b1', 'c1', 'k1', 'skip_piece')
    } catch (error) {
      expect((error as LilBotError).code).toBe('checkpoint_choice_not_found')
    }
    expect(f.store.has('b1', 'k1')).toBe(false)
    expect(f.audits).toHaveLength(0)

    // Second refusal enters waiting; choose resolves it; replay/double-click is refused.
    expect(f.refusals.recordRefusal('b1', 'c1', 'k1', ['k1'], true)).toEqual({ refusalCount: 2, waiting: true })
    expect(f.refusals.choose('b1', 'c1', 'k1', 'skip_piece')).toEqual({ ok: true, choice: 'skip_piece' })
    expect(() => f.refusals.choose('b1', 'c1', 'k1', 'skip_piece')).toThrow(LilBotError)

    // M5: ineligible (limited/hidden/non-main) chat NEVER enters waiting even after 2+ refusals.
    const changedBefore = f.getChanged()
    expect(f.refusals.recordRefusal('b1', 'c-limited', 'k2', ['k2'], false)).toEqual({ refusalCount: 1, waiting: false })
    expect(f.refusals.recordRefusal('b1', 'c-limited', 'k2', ['k2'], false)).toEqual({ refusalCount: 2, waiting: false })
    expect(f.refusals.recordRefusal('b1', 'c-limited', 'k2', ['k2'], false)).toEqual({ refusalCount: 3, waiting: false })
    expect(f.refusals.pending('b1', 'c-limited')).toBeNull()
    expect(f.getChanged()).toBe(changedBefore)
    f.db.close()
  })

  test('Fix #4 (M12): skip_piece does not auto-resume while the bot already has an active turn', async () => {
    const f = makeDb()
    f.db
      .query('INSERT INTO history_events(bot, session, at, event, key) VALUES (?, ?, ?, ?, ?)')
      .run('b1', 'c1', 1000, JSON.stringify({ type: 'user.message', messageId: 'm1', text: 'Stopped prompt', attachments: [] }), 'k-u')
    f.db
      .query('INSERT INTO history_events(bot, session, at, event, key) VALUES (?, ?, ?, ?, ?)')
      .run('b1', 'c1', 1001, JSON.stringify({ type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' }), 'k-f')
    f.refusals.recordRefusal('b1', 'c1', 'p1', ['p1'], true)
    f.refusals.recordRefusal('b1', 'c1', 'p1', ['p1'], true)

    let scheduled = 0
    const handlers = memoryHandlers(() => ({
      choices: {
        pending: (botId, chatId) => f.refusals.pending(botId, chatId ?? 'c1'),
        choose: (botId, chatId, pieceKey, choice) => f.refusals.choose(botId, chatId, pieceKey, choice),
        stoppedTurn: (botId, chatId) => f.refusals.stoppedTurn(botId, chatId),
        onNewSession: () => {}
      },
      bots: { hasActiveTurn: () => true } as never,
      chats: { find: () => undefined } as never
    }))
    const res = await handlers['memory.checkpointChoose']({ botId: 'b1', chatId: 'c1', pieceKey: 'p1', choice: 'skip_piece' }, () => {
      scheduled++
    })
    expect(res).toEqual({ ok: true, choice: 'skip_piece', resumed: false, needsResend: true })
    expect(scheduled).toBe(0)
    expect(f.store.has('b1', 'p1')).toBe(true)
    f.db.close()
  })
})
