import { describe, expect, test } from 'bun:test'
import { openDatabase } from '../../server/database/database'
import { type Evidence, MAX_EXTRA_SPLIT_PASSES, MemoryCheckpoint, PASS_CHARS } from '../../server/memory/memory-checkpoint'
import { findStoppedTurn } from '../../server/memory/memory-checkpoint-meta'
import { MemoryCheckpointRefusalStore } from '../../server/memory/memory-checkpoint-refusals'
import { MemoryCheckpointStore } from '../../server/memory/memory-checkpoint-store'
import {
  CHECKPOINT_KEEP_GOING_LABEL,
  CHECKPOINT_NEW_SESSION_LABEL,
  checkpointRefusalBody,
  checkpointRefusalTitle,
  checkpointSettledText,
  formatRefusalWhen
} from '../../shared/client/memory/checkpoint-refusal-copy'
import { LilBotError } from '../../shared/lilbot-error'

const refused = () => new LilBotError('review_refused', 'Refused by provider.')

function makeHarness(hasFallback = true) {
  const db = openDatabase(':memory:')
  const store = new MemoryCheckpointStore(db)
  const refusals = new MemoryCheckpointRefusalStore(db, store)
  let calls = 0
  let handler: (prompt: string, useBotModel: boolean) => Promise<void> = async () => {}
  const checkpoint = new MemoryCheckpoint(
    async (_botId, prompt, opts) => {
      calls++
      await handler(prompt, Boolean(opts?.useBotModel))
    },
    store,
    () => '',
    {
      hasFallbackModel: () => hasFallback,
      canAskOwner: () => true,
      recordRefusal: (b, c, k, ks, e, ctx) => refusals.recordRefusal(b, c, k, ks, e, ctx),
      clearPending: (b, c, k) => refusals.clearPending(b, c, k)
    }
  )
  return { db, store, refusals, checkpoint, getCalls: () => calls, resetCalls: () => (calls = 0), setHandler: (fn: typeof handler) => (handler = fn) }
}

describe('Option C binary splitting and plain-language card copy', () => {
  test('splits a refused multi-message pass to one message, saves every clean message immediately, and skips splitting on retry 2', async () => {
    const h = makeHarness()
    const evidence: Evidence[] = Array.from({ length: 10 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      text: i === 6 ? 'POISON_SINGLE_MESSAGE_6' : `Clean conversation message #${i}`
    }))
    // Seed stored history timestamps so pieceTiming resolves pieceAt without storing text.
    const baseAt = new Date(2026, 10, 25, 14, 10, 0).getTime()
    for (let i = 0; i < evidence.length; i++) {
      h.db
        .query('INSERT INTO history_items(bot, session, id, at, position, item, text) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('b1', 'c1', `row-${i}`, baseAt + i * 60_000, i, JSON.stringify({ kind: evidence[i].role, text: evidence[i].text }), evidence[i].text)
    }

    h.setHandler(async prompt => {
      if (prompt.includes('POISON_SINGLE_MESSAGE_6')) throw refused()
    })

    // Attempt 1: splits down to message #6, saves all 9 clean messages, records refusal #1 on message #6 only.
    await expect(h.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    expect(h.refusals.pending('b1', 'c1')).toBeNull()
    const reviewedAfter1 = h.db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM memory_checkpoint_reviewed WHERE bot_id = ?').get('b1')!.n
    expect(reviewedAfter1).toBe(9)

    // Attempt 2: only message #6 remains unreviewed -> exactly 2 model calls (review + bot), no extra splitting!
    h.resetCalls()
    await expect(h.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    expect(h.getCalls()).toBe(2)

    const card = h.refusals.pending('b1', 'c1')
    expect(card).not.toBeNull()
    expect(card!.singleMessage).toBe(true)
    expect(card!.usedTwoModels).toBe(true)
    expect(card!.pieceAt).toBe(baseAt + 6 * 60_000)
    expect(card!.messagesBack).toBe(4)
    expect(JSON.stringify(card)).not.toContain('POISON_SINGLE_MESSAGE_6')
    h.db.close()
  })

  test('continues saving clean top-level passes even when an earlier top-level pass hits a refusal', async () => {
    const h = makeHarness()
    const big1 = `POISON_PASS_1 ${'a'.repeat(PASS_CHARS - 20)}`
    const big2 = `CLEAN_PASS_2 ${'b'.repeat(PASS_CHARS - 20)}`
    const evidence: Evidence[] = [
      { role: 'user', text: big1 },
      { role: 'assistant', text: big2 }
    ]
    h.setHandler(async prompt => {
      if (prompt.includes('POISON_PASS_1')) throw refused()
    })
    await expect(h.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    // Pass 2 was still saved despite Pass 1 failing with review_refused!
    const reviewed = h.db.query<{ n: number }, [string]>('SELECT count(*) AS n FROM memory_checkpoint_reviewed WHERE bot_id = ?').get('b1')!.n
    expect(reviewed).toBe(1)
    h.db.close()
  })

  test('strictly bounds extra model calls when every message in a large pass is refused and marks it as a stretch', async () => {
    const h = makeHarness(true)
    const evidence: Evidence[] = Array.from({ length: 128 }, (_, i) => ({ role: 'user', text: `All refused #${i}` }))
    h.setHandler(async () => {
      throw refused()
    })
    await expect(h.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    // 1 initial pass + at most MAX_EXTRA_SPLIT_PASSES (12) sub-passes, each at most 2 model calls => <= 26 total calls.
    expect(h.getCalls()).toBeLessThanOrEqual((1 + MAX_EXTRA_SPLIT_PASSES) * 2)

    await expect(h.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    const card = h.refusals.pending('b1', 'c1')
    expect(card).not.toBeNull()
    expect(card!.singleMessage).toBe(false)
    h.db.close()
  })

  test('shared copy formatter matches exact calmer wording for single message, stretch, time, and fallback distance', () => {
    const now = new Date(2026, 10, 25, 16, 0, 0).getTime()
    const today210 = new Date(2026, 10, 25, 14, 10, 0).getTime()
    const yesterday945 = new Date(2026, 10, 24, 21, 45, 0).getTime()

    expect(formatRefusalWhen(today210, 40, now)).toBe('from around 2:10 pm')
    expect(formatRefusalWhen(yesterday945, 40, now)).toBe('from yesterday around 9:45 pm')
    expect(formatRefusalWhen(null, 42, now)).toBe('from about 40 messages back')
    expect(checkpointRefusalTitle(true)).toBe('One message couldn’t be saved to memory')
    expect(checkpointRefusalTitle(false)).toBe('One part couldn’t be saved to memory')
    expect(CHECKPOINT_KEEP_GOING_LABEL).toBe('Compact & continue')
    expect(CHECKPOINT_NEW_SESSION_LABEL).toBe('Start a new session')

    expect(checkpointRefusalBody({ singleMessage: true, pieceAt: today210, messagesBack: 12, usedTwoModels: true }, now)).toBe(
      'One message from around 2:10 pm couldn’t be read for memory. LilBot tried twice, with two different models. Everything else is saved, and the full conversation stays in your history.'
    )
    expect(checkpointRefusalBody({ singleMessage: false, pieceAt: null, messagesBack: 41, usedTwoModels: true }, now)).toBe(
      'A stretch of this conversation from about 40 messages back couldn’t be read for memory. LilBot tried twice, with two different models. Everything else is saved, and the full conversation stays in your history.'
    )
    expect(checkpointSettledText(false)).toBe('Continued without saving one earlier part.')
    expect(checkpointSettledText(true)).toBe('Continued without saving one earlier part. Send your message again to continue.')
  })

  test('findStoppedTurn detects clean stopped turn, returns none after completed turn, and refuses auto-resume when tools already ran', () => {
    const db = openDatabase(':memory:')
    const insertEv = (chat: string, ev: unknown, at: number) =>
      db.query('INSERT INTO history_events(bot, session, at, event, key) VALUES (?, ?, ?, ?, ?)').run('b1', chat, at, JSON.stringify(ev), crypto.randomUUID())

    // Clean stopped turn: user message -> memory_save failure with no tools or output.
    insertEv('c-clean', { type: 'user.message', messageId: 'm1', text: 'Ship the patch', attachments: [], origin: { deviceId: 'dev-1', name: 'Mac' } }, 1000)
    insertEv('c-clean', { type: 'turn.started' }, 1001)
    insertEv('c-clean', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' }, 1002)
    expect(findStoppedTurn(db, 'b1', 'c-clean')).toEqual({ kind: 'stopped', text: 'Ship the patch', attachmentIds: [], deviceId: 'dev-1' })

    // Hygiene pre-pass refusal after a completed turn: no stopped turn to resume.
    insertEv('c-done', { type: 'user.message', messageId: 'm2', text: 'Hello', attachments: [] }, 2000)
    insertEv('c-done', { type: 'turn.finished', status: 'completed', text: 'Hi!' }, 2001)
    expect(findStoppedTurn(db, 'b1', 'c-done')).toEqual({ kind: 'none' })

    // Mid-turn overflow after a tool ran: unsafe to auto-resend.
    insertEv('c-tool', { type: 'user.message', messageId: 'm3', text: 'Run deploy', attachments: [] }, 3000)
    insertEv('c-tool', { type: 'tool.started', toolId: 't1', name: 'shell', detail: 'echo hi' }, 3001)
    insertEv('c-tool', { type: 'turn.finished', status: 'failed', text: '', failure: 'memory_save' }, 3002)
    expect(findStoppedTurn(db, 'b1', 'c-tool')).toEqual({ kind: 'unsafe' })
    db.close()
  })
})
