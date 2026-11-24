/** Second-engine conformance proof for isolated memory reviews and pre-compress checkpoints over real HTTP scoped MCP. */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionGrants } from '../../server/app-session-grants'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { MemoryCheckpoint } from '../../server/memory/memory-checkpoint'
import { MemoryCheckpointStore } from '../../server/memory/memory-checkpoint-store'
import { MemoryReviewer } from '../../server/memory/memory-reviewer'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { ReviewQueue } from '../../server/memory/review-queue'
import { createScopedMcp } from '../../server/system/scoped-mcp'
import { scopedToolsFor } from '../../server/system/session-scope'
import { SystemChanges } from '../../server/system/system-changes'
import type { SystemDeps } from '../../server/system/system-deps'
import { memoryTools } from '../../server/system/tool-memory'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

test('ScriptedEngine runs isolated memory review and checkpoint passes over real HTTP scoped MCP with fail-closed enforcement', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-conf-rev-'))
  const db = openDatabase(join(dir, 'lilbot.db'))
  const store = new BotStore(db)
  const memory = new MemoryService(new MemoryStore(db))
  const queue = new ReviewQueue(db)
  const checkpointStore = new MemoryCheckpointStore(db)
  const engine = new ScriptedEngine()
  const bots = new BotService(engine, store, new BotPrefsStore(db), new Workspaces(join(dir, 'ws')), memory)
  const tools = memoryTools({ bots, memory, memoryChanged: () => {} } as unknown as SystemDeps)
  const changes = new SystemChanges(db)

  let port = 0
  const sessionGrants = createSessionGrants(
    db,
    'tok',
    (_b, c) => c,
    () => false,
    () => grant =>
      sessionGrants.grants.connectionsFor(
        grant,
        `http://127.0.0.1:${port}`,
        scopedToolsFor(grant.scope, tools, false).map(t => t.name),
        false
      )
  )
  let scopedHandler: ReturnType<typeof createScopedMcp>
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: req => scopedHandler(req, new URL(req.url).pathname)
  })
  port = server.port!
  scopedHandler = createScopedMcp({
    port,
    grants: sessionGrants.grants,
    bots: () => store.list(),
    tools,
    changes,
    beyondOwn: () => false,
    reviewTracker: sessionGrants.reviewTracker
  })
  cleanups.push(() => {
    server.stop(true)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const bot = await bots.createBot({ name: 'Scripted Bot', function: 'Testing', instructions: '' })
  const ownerFact = memory.write({ botId: bot.id, kind: 'profile', scope: 'bot', text: 'Owner standing rule.', author: 'user' })
  const reviewer = new MemoryReviewer(
    queue,
    bots,
    undefined,
    Date.now,
    id => store.exists(id),
    sessionGrants.prepareReview,
    id => memory.contextBlock(id).text
  )
  const checkpoint = new MemoryCheckpoint(
    (b, prompt) => reviewer.runPass(b, prompt, true),
    checkpointStore,
    id => memory.contextBlock(id).text
  )

  // 1. Missing sessionMcp fails closed on ScriptedEngine.reviewMemory.
  await expect(engine.reviewMemory(store.get(bot.id).engineBotId, 'hi', { onChat: () => {} })).rejects.toMatchObject({ code: 'session_mcp_unavailable' })

  // 2. Checkpoint pass where every attempted write is refused fails closed and does NOT mark evidence reviewed.
  let mode: 'all-refused' | 'mixed-ok' = 'all-refused'
  let seenTools: string[] = []
  engine.setTurnHandler(async ctx => {
    seenTools = engine.sessionDiscoveredTools(ctx.chatId)?.get('lilbot') ?? []
    const badForget = await ctx.callMcp('lilbot_memory_forget', { id: ownerFact.id }, 'lilbot')
    expect(badForget.ok).toBe(false)
    if (mode === 'mixed-ok') {
      const saved = await ctx.callMcp('lilbot_memory_save', { kind: 'profile', text: 'Uses Bun for all checks.' }, 'lilbot')
      expect(saved.ok).toBe(true)
    }
    return 'Done.'
  })

  const evidence = [{ role: 'user' as const, text: 'Remember that we use Bun for all checks.' }]
  await expect(checkpoint.save(bot.id, 'main-1', evidence)).rejects.toMatchObject({ code: 'review_failed' })
  expect(seenTools.sort()).toEqual(['lilbot_memory_forget', 'lilbot_memory_recall', 'lilbot_memory_save'])
  expect(memory.list(bot.id).some(f => f.id === ownerFact.id)).toBe(true)

  // 3. Retry re-runs the same evidence (was NOT recorded on failure), saves with via: 'review', and records it once complete.
  mode = 'mixed-ok'
  expect(await checkpoint.save(bot.id, 'main-1', evidence)).toBe(1)
  expect(memory.list(bot.id).some(f => f.text === 'Uses Bun for all checks.' && f.via === 'review')).toBe(true)
  expect(await checkpoint.save(bot.id, 'main-1', evidence)).toBe(0)
})
