import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { chatKinds } from '../../server/bots/hidden-chats'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { createEngineApi } from '../../server/http/engine-api'
import { MemoryCheckpointStore } from '../../server/memory/memory-checkpoint-store'
import { MemoryReviewer } from '../../server/memory/memory-reviewer'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { ReviewQueue } from '../../server/memory/review-queue'
import { ReviewSessionStore, reviewSessionRefusal } from '../../server/memory/review-session-store'
import { SkillsService } from '../../server/skills/skills-service'
import { createMemoryReviewMcp } from '../../server/system/memory-review-mcp'
import { SystemChanges } from '../../server/system/system-changes'
import { SESSION_MCP_PATH, sessionMcpKey } from '../../server/system/system-connection'
import type { SystemDeps } from '../../server/system/system-deps'
import { memoryTools } from '../../server/system/tool-memory'
import { fakeEngine } from '../helpers/fake-engine'

describe('persisted review sessions across continuations, restart, skills refusal, and checkpoint runSession wiring', () => {
  test('persisted review_sessions blocks continuations and skills writes across restart, refuses orphaned runId, and activates reviewing() during /engine/history/save', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lilbot-rev-persist-'))
    try {
      const dbPath = join(dir, 'lilbot.db')
      const db1 = openDatabase(dbPath)
      const store1 = new BotStore(db1)
      const memory1 = new MemoryService(new MemoryStore(db1))
      const reviewSessions1 = new ReviewSessionStore(db1)
      const skills1 = new SkillsService(join(dir, 'skills'), db1)
      const tools1 = memoryTools({ bots: undefined as never, memory: memory1, memoryChanged: () => {} } as unknown as SystemDeps)
      const reviewMcp1 = createMemoryReviewMcp({ engineToken: 'tok', port: 4321, bots: () => store1.list(), tools: tools1, changes: new SystemChanges(db1) })

      let reviewingDuringPass = false
      let capturedRunId = ''
      let reviewer1!: MemoryReviewer
      const fake = fakeEngine()
      fake.engine.reviewMemory = async (_id, _prompt, options) => {
        options.onChat('rev-orig')
        capturedRunId = new URL(options.mcpConnection!.url).searchParams.get('run')!
        reviewingDuringPass = reviewer1.reviewing(bot.id)
        const headers = { host: '127.0.0.1:4321', authorization: `Bearer ${options.mcpConnection!.bearerToken}` }
        await reviewMcp1.handler(
          new Request(`http://127.0.0.1:4321${SESSION_MCP_PATH}?run=${capturedRunId}`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
          })
        )
      }
      const bots1 = new BotService(fake.engine, store1, new BotPrefsStore(db1), new Workspaces(join(dir, 'ws')), memory1, {
        startReviewRun: botId => reviewMcp1.startRun(botId)
      })
      const bot = await bots1.createBot({ name: 'Alpha', function: 'f', instructions: 'i' })
      memory1.write({ botId: bot.id, kind: 'profile', text: 'Owner fact must survive restart.', author: 'user' })
      reviewer1 = new MemoryReviewer(new ReviewQueue(db1), bots1, undefined, Date.now, id => store1.exists(id), reviewSessions1)
      const history1 = new HistoryService(
        new HistoryStore(db1),
        fake.engine,
        async () => [],
        () => true
      )
      const api1 = createEngineApi(memory1, 'tok', 4321, {
        history: history1,
        bots: bots1,
        skills: skills1,
        reviewer: reviewer1,
        checkpointStore: new MemoryCheckpointStore(db1),
        botExists: id => store1.exists(id)
      })

      // /engine/history/save must activate reviewer.reviewing(bot.id) during the pass and persist rev-orig.
      const saveRes = await api1(
        new Request('http://127.0.0.1:4321/engine/history/save', {
          method: 'POST',
          headers: { host: '127.0.0.1:4321', authorization: 'Bearer tok', 'x-lilbot-bot-capability': botCapability('tok', bot.id) },
          body: JSON.stringify({ chatId: 'main-1', messages: [{ role: 'user', text: 'Plain message.' }] })
        }),
        '/engine/history/save'
      )
      expect(saveRes.status).toBe(200)
      expect(reviewingDuringPass).toBe(true)
      db1.close()

      // Simulate LilBot restart on the same SQLite database.
      const db2 = openDatabase(dbPath)
      const store2 = new BotStore(db2)
      const memory2 = new MemoryService(new MemoryStore(db2))
      const reviewSessions2 = new ReviewSessionStore(db2)
      const skills2 = new SkillsService(join(dir, 'skills'), db2)
      const tools2 = memoryTools({ bots: undefined as never, memory: memory2, memoryChanged: () => {} } as unknown as SystemDeps)
      const reviewMcp2 = createMemoryReviewMcp({ engineToken: 'tok', port: 4321, bots: () => store2.list(), tools: tools2, changes: new SystemChanges(db2) })

      // Orphaned review session after restart: old runId is refused with 403; owner fact untouched.
      const orphaned = await reviewMcp2.handler(
        new Request(`http://127.0.0.1:4321${SESSION_MCP_PATH}?run=${capturedRunId}`, {
          method: 'POST',
          headers: { host: '127.0.0.1:4321', authorization: `Bearer ${sessionMcpKey('tok', bot.id, 'review', capturedRunId)}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_memory_forget', arguments: { id: 'aaaa' } } })
        })
      )
      expect(orphaned.status).toBe(403)
      expect(memory2.list(bot.id).some(f => f.text === 'Owner fact must survive restart.')).toBe(true)

      // Persisted review_sessions + rootOf lineage: both rev-orig and compressed continuation rev-cont count as 'lilbot' and cannot write/delete/read unoffered skills.
      const roots = new Map<string, string | null>([
        ['rev-cont', 'rev-orig'],
        ['rev-unreadable', null]
      ])
      const rootOf = (_b: string, c: string) => (roots.has(c) ? roots.get(c)! : c)
      const kind = chatKinds(rootOf, chat => reviewSessions2.has(chat))
      expect(kind(bot.id, 'rev-orig')).toBe('lilbot')
      expect(kind(bot.id, 'rev-cont')).toBe('lilbot')
      expect(kind(bot.id, 'main-1')).toBe('conversation')

      let activeReview = false
      const inReview = reviewSessionRefusal(reviewSessions2, rootOf, () => activeReview)
      const api2 = createEngineApi(memory2, 'tok', 4321, {
        bots: { listBots: async () => [{ id: bot.id }] } as unknown as BotService,
        skills: skills2,
        botExists: id => store2.exists(id),
        inReview
      })
      const skillCall = (action: string, body: unknown, session?: string) =>
        api2(
          new Request(`http://127.0.0.1:4321/engine/skills/${action}`, {
            method: 'POST',
            headers: {
              host: '127.0.0.1:4321',
              authorization: 'Bearer tok',
              'x-lilbot-bot-capability': botCapability('tok', bot.id),
              ...(session ? { 'x-lilbot-session': session } : {})
            },
            body: JSON.stringify(body)
          }),
          `/engine/skills/${action}`
        )
      const writeBody = { name: 'rogue-skill', action: 'create', content: '---\nname: rogue-skill\ndescription: bad\n---\nNo.' }
      expect((await skillCall('write', writeBody, 'rev-orig')).status).toBe(422)
      expect((await skillCall('write', writeBody, 'rev-cont')).status).toBe(422)
      expect((await skillCall('delete', { name: 'rogue-skill' }, 'rev-orig')).status).toBe(404)
      expect((await skillCall('read', { name: 'unoffered-secret' }, 'rev-orig')).status).toBe(403)
      // Unreadable lineage or missing session fails closed while a review runs, while ordinary chat with its own session stays allowed.
      activeReview = true
      expect((await skillCall('write', writeBody, 'rev-unreadable')).status).toBe(422)
      expect((await skillCall('write', writeBody)).status).toBe(422)
      expect((await skillCall('write', writeBody, 'main-1')).status).toBe(200)
      expect(skills2.read('rogue-skill')).toBeTruthy()
      db2.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
