/** Engine-agnostic conformance suite (Part 5: PR B memory hooks in LilBot's conversation layer,
 *  change-only + K=15 delivery, compaction reset, direct review queueing, neutral pre-compress checkpoint,
 *  and per-bot memory-checkpoint key isolation). */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MEMORY_RULES } from '../../server/memory/memory-rules'
import { ReviewQueue } from '../../server/memory/review-queue'
import { startConformanceApp } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function boot() {
  const app = await startConformanceApp()
  cleanups.push(app.close)
  const bot = await app.services.bots.createBot({ name: 'MemoryBot', function: 'Control-plane memory bot', instructions: 'Be brief.' })
  return { ...app, bot }
}

describe('engine conformance: PR B control-plane memory hooks', () => {
  test('turn 1 injects rules+facts via api_text, skips turns 2..15, refreshes at turn 16 and on change/compaction/new chat', async () => {
    const { engine, services, bot } = await boot()
    await services.bots.writeMemory({ botId: bot.id, kind: 'profile', scope: 'bot', text: 'Uses Adelaide time.' })
    const seenLines: string[] = []
    let compactNext = false
    engine.setTurnHandler(async ctx => {
      seenLines.push(ctx.input.origin?.line ?? '')
      if (ctx.input.text === 'save-fact') {
        await ctx.callMcp('lilbot_memory_save', { kind: 'profile', text: 'Drinks oat flat white.' })
      }
      const compacted = compactNext ? { beforeTokens: 90_000, afterTokens: 20_000 } : undefined
      compactNext = false
      return { text: `ack:${ctx.input.text}`, ...(compacted ? { compacted } : {}) }
    })

    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('ok')
    expect(seenLines[0]).toContain('<lilbot-memory>')
    expect(seenLines[0]).toContain(MEMORY_RULES)
    expect(seenLines[0]).toContain('Uses Adelaide time.')

    for (let turn = 2; turn <= 15; turn++) {
      await chat.send(`turn-${turn}`)
      expect(seenLines[turn - 1]).toBe('')
    }

    // Turn 16 refreshes facts (without repeating rules).
    await chat.send('turn-16')
    expect(seenLines[15]).toContain('Uses Adelaide time.')
    expect(seenLines[15]).not.toContain(MEMORY_RULES)

    // Saving a fact triggers refresh on the next turn.
    await chat.send('save-fact')
    expect(seenLines[16]).toBe('')
    await chat.send('after-save')
    expect(seenLines[17]).toContain('Drinks oat flat white.')
    expect(seenLines[17]).not.toContain(MEMORY_RULES)

    // Compaction forces full turn-1 re-injection (including rules) on the next turn.
    compactNext = true
    await chat.send('trigger-compact')
    await chat.send('after-compact')
    expect(seenLines[19]).toContain(MEMORY_RULES)
    expect(seenLines[19]).toContain('Drinks oat flat white.')
    chat.close()

    // New session gets full turn-1 block immediately.
    const fresh = await services.bots.newChat(bot.id, () => {})
    await fresh.send('hi')
    expect(seenLines[20]).toContain(MEMORY_RULES)
    expect(seenLines[20]).toContain('Drinks oat flat white.')
    fresh.close()
  })

  test('check sessions and narrow webhooks get zero memory injection; memory-capable webhooks get turn-1 memory', async () => {
    const { engine, services, bot } = await boot()
    await services.bots.writeMemory({ botId: bot.id, kind: 'profile', scope: 'bot', text: 'Secret preference.' })
    const lines: string[] = []
    engine.setTurnHandler(async ctx => {
      lines.push(ctx.input.origin?.line ?? '')
      return 'done'
    })

    await services.bots.runRoutine(bot.id, 'check item', { runId: 'chk-1', access: 'check', sessionMcp: [], onChat: () => {} }).catch(() => {})
    // Test with real check grant via System MCP so ScriptedEngine runs the turn.
    const checkRun = await services.bots.runRoutine(bot.id, 'check item', {
      runId: 'chk-2',
      access: 'check',
      sessionMcp: [services.system.connection(bot.id)],
      onChat: () => {}
    })
    expect(checkRun.status).toBe('completed')
    expect(lines.at(-1)).not.toContain('<lilbot-memory>')

    const narrowWh = await services.bots.runRoutine(bot.id, 'narrow webhook', {
      runId: 'wh-narrow',
      access: { kind: 'webhook', capabilities: ['delegation'] },
      sessionMcp: [services.system.connection(bot.id)],
      onChat: () => {}
    })
    expect(narrowWh.status).toBe('completed')
    expect(lines.at(-1)).not.toContain('<lilbot-memory>')

    const memWh = await services.bots.runRoutine(bot.id, 'memory webhook', {
      runId: 'wh-mem',
      access: { kind: 'webhook', capabilities: ['memory'] },
      sessionMcp: [services.system.connection(bot.id)],
      onChat: () => {}
    })
    expect(memWh.status).toBe('completed')
    expect(lines.at(-1)).toContain('<lilbot-memory>')
    expect(lines.at(-1)).toContain('Secret preference.')
  })

  test('main-chat turns queue for review directly, neutral pre-compress runs in-process, and memoryConnection omits master token', async () => {
    const { engine, services, bot, dir } = await boot()
    const masterToken = readFileSync(join(dir, 'data', 'engine-token'), 'utf8').trim()
    const conn = services.memoryConnection(bot.id)
    expect(conn.checkpointKey).toBeTruthy()
    expect(conn.checkpointKey).not.toBe(masterToken)
    expect('tokenFile' in conn).toBe(false)
    expect(JSON.stringify(conn)).not.toContain(masterToken)
    expect(JSON.stringify(conn)).not.toContain('engine-token')

    let savedViaCheckpoint = false
    let postCheckpointLine = ''
    engine.setTurnHandler(async ctx => {
      if (ctx.hidden && ctx.input.text.includes('Before your conversation is summarised')) {
        expect(ctx.input.text).not.toContain('<lilbot-memory>')
        expect(ctx.input.text).toContain('blue iris')
        const res = await ctx.callMcp('lilbot_memory_save', { kind: 'profile', text: 'Likes blue iris.' })
        savedViaCheckpoint = res.ok
        return 'saved'
      }
      postCheckpointLine = ctx.input.origin?.line ?? ''
      return 'noted'
    })

    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    await chat.send('Remember that my favourite flower is blue iris.')
    const queue = new ReviewQueue(services.threads.store.db)
    expect(queue.pending().some(p => p.botId === bot.id && p.turns === 1)).toBe(true)

    // Neutral in-process pre-compress checkpoint runs with zero HTTP, saves memory, and invalidates turn context.
    const ckpt = await engine.triggerPreCompress(bot.id, chat.snapshot.chatId)
    expect(ckpt).toEqual({ saved: true, passes: 1 })
    expect(savedViaCheckpoint).toBe(true)

    await chat.send('next turn after checkpoint')
    expect(postCheckpointLine).toContain(MEMORY_RULES)
    expect(postCheckpointLine).toContain('Likes blue iris.')
    chat.close()
  })
})
