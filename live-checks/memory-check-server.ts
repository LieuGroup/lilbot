import { join } from 'node:path'
import { createSessionGrants } from '../server/app-session-grants'
import { BotPrefsStore } from '../server/bots/bot-prefs-store'
import { BotService } from '../server/bots/bot-service'
import { BotStore } from '../server/bots/bot-store'
import { Workspaces } from '../server/bots/workspaces'
import { openDatabase } from '../server/database/database'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { MEMORY_ADAPTER_VERSION } from '../server/engines/hermes/hermes-memory-setup'
import { createEngineApi, engineToken } from '../server/http/engine-api'
import { checkpointConnectionFor } from '../server/memory/memory-checkpoint-key'
import { MemoryReviewer } from '../server/memory/memory-reviewer'
import { MemoryService } from '../server/memory/memory-service'
import { MemoryStore } from '../server/memory/memory-store'
import { MemoryTurnContext } from '../server/memory/memory-turn-context'
import { ReviewQueue } from '../server/memory/review-queue'
import { createScopedMcp } from '../server/system/scoped-mcp'
import { SESSION_MCP_PREFIX } from '../server/system/session-grants'
import { scopedToolsFor } from '../server/system/session-scope'
import { SystemChanges } from '../server/system/system-changes'
import { SYSTEM_PATH, systemConnection, toolsVersion } from '../server/system/system-connection'
import type { SystemDeps } from '../server/system/system-deps'
import { createSystemMcp } from '../server/system/system-mcp'
import { memoryTools } from '../server/system/tool-memory'

/** Isolated memory + System MCP + session-bound scoped MCP test harness for `live-checks/memory-check.ts`. */
export function startMemoryCheckHarness(scratch: string, port: number, reviewProvider: string, reviewModel: string) {
  const database = openDatabase(join(scratch, 'lilbot.db'))
  const store = new BotStore(database)
  const memory = new MemoryService(new MemoryStore(database))
  const engine = new HermesEngine([])
  const queue = new ReviewQueue(database)
  const token = engineToken(scratch)
  const url = `http://127.0.0.1:${port}`
  const tools = memoryTools({ bots: undefined as never, memory, memoryChanged: () => {} } as unknown as SystemDeps)
  const names = tools.map(t => t.name)
  const version = toolsVersion(tools)
  const changes = new SystemChanges(database)

  const sessionGrants = createSessionGrants(
    database,
    token,
    (_b, c) => c,
    () => false,
    () => grant =>
      sessionGrants.grants.connectionsFor(
        grant,
        url,
        scopedToolsFor(grant.scope, tools, false).map(t => t.name),
        false
      )
  )
  const scoped = createScopedMcp({
    port,
    grants: sessionGrants.grants,
    bots: () => store.list(),
    tools,
    changes,
    beyondOwn: () => false,
    reviewTracker: sessionGrants.reviewTracker
  })
  const turnContext = new MemoryTurnContext(memory)
  let reviewer: MemoryReviewer
  const memoryConnection = (botId: string) => checkpointConnectionFor(url, token, botId)
  const bots = new BotService(engine, store, new BotPrefsStore(database), new Workspaces(join(scratch, 'workspaces')), memory, {
    connections: botId => [systemConnection(url, token, botId, names, version)],
    memoryConnection,
    memoryContext: turnContext,
    turnNotes: turnContext,
    conversationHooks: {
      onTurnCompleted: (id, chatId, user, assistant) => reviewer.record(id, chatId, user, assistant),
      onCompacted: (id, chatId) => turnContext.invalidateChat(id, chatId)
    }
  })
  reviewer = new MemoryReviewer(
    queue,
    bots,
    { enabled: true, turns: 10, quietMs: 120_000, minTurns: 3, model: { provider: reviewProvider, model: reviewModel } },
    Date.now,
    id => store.exists(id),
    sessionGrants.prepareReview,
    id => memory.contextBlock(id).text
  )
  const mcp = createSystemMcp({ engineToken: token, port, bots: () => store.list(), tools, changes, instructions: 'LilBot memory tools.', refusal: async () => null })
  const engineApi = createEngineApi(memory, token, port, {
    botExists: id => store.exists(id),
    adapterVersion: MEMORY_ADAPTER_VERSION,
    reviewer,
    skillWriteLocked: sessionGrants.skillWriteLocked
  })
  let memoryCalls = 0
  const adapterVersions = new Set<string>()
  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === SYSTEM_PATH) return mcp(request)
      if (pathname.startsWith(SESSION_MCP_PREFIX)) return scoped(request, pathname)
      memoryCalls++
      adapterVersions.add(request.headers.get('x-lilbot-adapter-version') ?? 'none')
      return engineApi(request, pathname)
    }
  })
  return { database, store, memory, queue, bots, reviewer, server, memoryConnection, memoryCalls: () => memoryCalls, adapterVersions }
}
