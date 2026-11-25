import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase } from '../../server/database/database'
import { reviewMemory } from '../../server/engines/hermes/hermes-memory-review'
import { MemoryCheckpoint, passKeyOf } from '../../server/memory/memory-checkpoint'
import { type CheckpointChoiceAudit, MemoryCheckpointRefusalStore } from '../../server/memory/memory-checkpoint-refusals'
import { MemoryCheckpointStore } from '../../server/memory/memory-checkpoint-store'
import { LilBotError } from '../../shared/lilbot-error'

const refused = () => new LilBotError('review_refused', 'Refused by model.')
const transient = () => new LilBotError('review_failed', 'Timed out.')

function setup(options: { hasFallback?: boolean; canAsk?: boolean } = {}) {
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
  const calls: { botId: string; useBotModel: boolean }[] = []
  let handler: (botId: string, prompt: string, opts?: { useBotModel?: boolean }) => Promise<void> = async () => {}
  const checkpoint = new MemoryCheckpoint(
    async (botId, prompt, opts) => {
      calls.push({ botId, useBotModel: Boolean(opts?.useBotModel) })
      await handler(botId, prompt, opts)
    },
    store,
    () => '',
    {
      hasFallbackModel: () => options.hasFallback ?? true,
      canAskOwner: () => options.canAsk ?? true,
      recordRefusal: (b, c, k, ks, e, ctx) => refusals.recordRefusal(b, c, k, ks, e, ctx),
      clearPending: (b, c, k) => refusals.clearPending(b, c, k)
    }
  )
  return { db, store, refusals, checkpoint, calls, audits, getChanged: () => changed, setHandler: (fn: typeof handler) => (handler = fn) }
}

describe('Option B: persistent pre-compress memory-save refusals', () => {
  test('review-model refusal retries once on the bot model and succeeds cleanly with no card', async () => {
    const f = setup()
    f.setHandler(async (_b, _p, opts) => {
      if (!opts?.useBotModel) throw refused()
    })
    expect(await f.checkpoint.save('b1', 'c1', [{ role: 'user', text: 'Refused only by review model.' }])).toBe(1)
    expect(f.calls).toEqual([
      { botId: 'b1', useBotModel: false },
      { botId: 'b1', useBotModel: true }
    ])
    expect(f.refusals.pending('b1', 'c1')).toBeNull()
    expect(f.getChanged()).toBe(0)
    f.db.close()
  })

  test('both models refusing once shows no card; refusing twice on the same piece surfaces the card and never skips automatically', async () => {
    const f = setup()
    f.setHandler(async () => {
      throw refused()
    })
    const evidence = [{ role: 'user' as const, text: 'Sensitive earlier message that never appears in storage.' }]

    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    expect(f.calls).toHaveLength(2)
    expect(f.refusals.pending('b1', 'c1')).toBeNull()
    expect(f.getChanged()).toBe(0)

    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    expect(f.calls).toHaveLength(4)
    const card = f.refusals.pending('b1', 'c1')
    expect(card).not.toBeNull()
    expect(card!.refusalCount).toBe(2)
    expect(JSON.stringify(card)).not.toContain('Sensitive earlier message')
    expect(f.getChanged()).toBe(1)

    // Without Oscar's explicit choice, a third attempt still fails closed and never skips.
    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    expect(f.refusals.pending('b1', 'c1')?.refusalCount).toBe(3)
    f.db.close()
  })

  test('transient failures on review model or fallback model never count as refusals and never show a card', async () => {
    const f = setup()
    f.setHandler(async () => {
      throw transient()
    })
    const evidence = [{ role: 'user' as const, text: 'Ordinary message.' }]
    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_failed' })
    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_failed' })
    // No fallback to bot model on transient failure.
    expect(f.calls.every(c => !c.useBotModel)).toBe(true)
    expect(f.refusals.pending('b1', 'c1')).toBeNull()

    // Review refuses, bot fallback hits transient failure: still never counts as dual refusal.
    f.setHandler(async (_b, _p, opts) => {
      throw opts?.useBotModel ? transient() : refused()
    })
    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_failed' })
    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_failed' })
    expect(f.refusals.pending('b1', 'c1')).toBeNull()
    f.db.close()
  })

  test('skip_piece marks only the refused piece reviewed and records audit; new_session skips nothing and records audit', async () => {
    const f = setup()
    const bigA = 'A'.repeat(100_000)
    const bigB = 'B'.repeat(100_000)
    f.setHandler(async (_b, prompt) => {
      if (prompt.includes('AAAA')) throw refused()
    })
    const evidence = [
      { role: 'user' as const, text: bigA },
      { role: 'user' as const, text: bigB }
    ]
    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    await expect(f.checkpoint.save('b1', 'c1', evidence)).rejects.toMatchObject({ code: 'review_refused' })
    const card = f.refusals.pending('b1', 'c1')!
    expect(card).not.toBeNull()

    // Choosing skip_piece records choice and unblocks ONLY bigA (a new unreviewed message bigC is still reviewed).
    expect(f.refusals.choose('b1', 'c1', card.pieceKey, 'skip_piece')).toEqual({ ok: true, choice: 'skip_piece' })
    expect(f.refusals.pending('b1', 'c1')).toBeNull()
    expect(f.audits).toEqual([{ at: expect.any(Number), botId: 'b1', pieceKey: card.pieceKey, choice: 'skip_piece', chosenBy: 'oscar' }])
    expect(await f.checkpoint.save('b1', 'c1', [...evidence, { role: 'user', text: 'Fresh message C.' }])).toBe(1)

    // On another chat, choosing new_session records audit and marks NOTHING skipped.
    const bigD = 'D'.repeat(100_000)
    f.setHandler(async () => {
      throw refused()
    })
    await expect(f.checkpoint.save('b1', 'c2', [{ role: 'user', text: bigD }])).rejects.toMatchObject({ code: 'review_refused' })
    await expect(f.checkpoint.save('b1', 'c2', [{ role: 'user', text: bigD }])).rejects.toMatchObject({ code: 'review_refused' })
    const card2 = f.refusals.pending('b1', 'c2')!
    expect(f.refusals.choose('b1', 'c2', card2.pieceKey, 'new_session')).toEqual({ ok: true, choice: 'new_session' })
    expect(f.store.has('b1', card2.pieceKey)).toBe(false)
    expect(f.audits.at(-1)).toMatchObject({ botId: 'b1', pieceKey: card2.pieceKey, choice: 'new_session', chosenBy: 'oscar' })
    expect(passKeyOf(['x'])).toBe('x')
    f.db.close()
  })

  test('Hermes reviewMemory classifies only content_policy_blocked as review_refused; provider_policy_blocked and transient codes fail as review_failed', async () => {
    const runWith = (payload: Record<string, unknown>) =>
      reviewMemory(
        'bot-1',
        'prompt',
        { sessionMcp: [{ name: 'lilbot', url: 'http://127.0.0.1:1/mcp', bearerToken: 't', timeoutSeconds: 30, tools: ['lilbot_memory_save'] }], onChat: () => {} },
        async (_profile, onEvent) =>
          ({
            request: async (method: string) => {
              if (method === 'config.get') return { value: 'off' }
              if (method === 'session.create') return { session_id: 's1', stored_session_id: 's1' }
              if (method === 'session.info') return { enabled_toolsets: ['mcp-editor_lilbot_00000000'] }
              if (method === 'tools.show') return { sections: [] }
              if (method === 'prompt.submit') queueMicrotask(() => onEvent?.({ type: 'message.complete', payload } as never))
              return {}
            },
            close: () => {}
          }) as never,
        async () => {}
      )
    for (const [payload, code, text] of [
      [{ status: 'error', error_surface: { layer: 'provider', code: 'content_policy_blocked', retryable: false } }, 'review_refused', ''],
      [{ status: 'error', failure_reason: 'content_policy_blocked' }, 'review_refused', ''],
      [{ status: 'error', error_surface: { layer: 'provider', code: 'provider_policy_blocked', retryable: false } }, 'review_failed', 'provider_policy_blocked'],
      [{ status: 'error', failure_reason: 'provider_policy_blocked' }, 'review_failed', 'provider_policy_blocked'],
      [{ status: 'error', error_surface: { layer: 'provider', code: 'server_error', retryable: true } }, 'review_failed', 'server_error'],
      [{ status: 'error', error_surface: { layer: 'provider', code: 'timeout', retryable: true } }, 'review_failed', 'timeout']
    ] as const) {
      await expect(runWith(payload as Record<string, unknown>)).rejects.toMatchObject({
        code,
        ...(text ? { message: expect.stringContaining(text) } : {})
      })
    }
  })

  test('migration 43 -> 44 adds memory_checkpoint_refusals cleanly', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mig44-'))
    try {
      const file = join(dir, 'lilbot.db')
      const db = openDatabase(file)
      db.exec('DROP TABLE memory_checkpoint_refusals; PRAGMA user_version = 43;')
      db.close()
      const upgraded = openDatabase(file)
      expect(upgraded.query('PRAGMA user_version').get()).toEqual({ user_version: 44 })
      expect(upgraded.query("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_checkpoint_refusals'").get()).toEqual({
        name: 'memory_checkpoint_refusals'
      })
      upgraded.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
