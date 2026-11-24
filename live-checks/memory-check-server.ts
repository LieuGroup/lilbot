import { join } from 'node:path'
import { BotPrefsStore } from '../server/bots/bot-prefs-store'
import { BotService } from '../server/bots/bot-service'
import { BotStore } from '../server/bots/bot-store'
import { Workspaces } from '../server/bots/workspaces'
import { openDatabase } from '../server/database/database'
import { HermesEngine } from '../server/engines/hermes/hermes-engine'
import { MEMORY_ADAPTER_VERSION } from '../server/engines/hermes/hermes-memory-setup'
import { createEngineApi, engineToken } from '../server/http/engine-api'
import { MemoryReviewer } from '../server/memory/memory-reviewer'
import { MemoryService } from '../server/memory/memory-service'
import { MemoryStore } from '../server/memory/memory-store'
import { ReviewQueue } from '../server/memory/review-queue'
import { systemSessionGate } from '../server/system/check-access'
import { SystemChanges } from '../server/system/system-changes'
import { systemConnection, toolsVersion } from '../server/system/system-connection'
import type { SystemDeps } from '../server/system/system-deps'
import { createSystemMcp } from '../server/system/system-mcp'
import { memoryTools } from '../server/system/tool-memory'
import { CallingChats } from '../server/threads/calling-chats'

/** Isolated memory + System MCP test harness for `live-checks/memory-check.ts`. */
export function startMemoryCheckHarness(scratch: string, port: number, reviewProvider: string, reviewModel: string) {
  const database = openDatabase(join(scratch, 'lilbot.db'))
  const store = new BotStore(database)
  const memory = new MemoryService(new MemoryStore(database))
  const engine = new HermesEngine([])
  const queue = new ReviewQueue(database)
  const token = engineToken(scratch)
  const calls = new CallingChats()
  const url = `http://127.0.0.1:${port}`
  const tools = memoryTools({ bots: undefined as never, memory, memoryChanged: () => {} } as unknown as SystemDeps)
  const names = tools.map(t => t.name)
  const version = toolsVersion(tools)

  const bots = new BotService(engine, store, new BotPrefsStore(database), new Workspaces(join(scratch, 'workspaces')), memory, {
    connections: botId => [systemConnection(url, token, botId, names, version)]
  })
  const reviewer = new MemoryReviewer(queue, bots, { enabled: true, turns: 10, quietMs: 120_000, minTurns: 3, model: { provider: reviewProvider, model: reviewModel } })
  const stopCalls = engine.onToolCall(call => {
    const bot = store.list().find(b => b.engineBotId === call.engineBotId)
    if (bot) calls.saw(bot.id, call.chatId, call.tool, call.args, call.callId)
  })
  const gate = systemSessionGate(tools, { checking: () => false, isCheck: () => false }, { hasRuns: () => false, forChat: () => null }, calls, () => false, false, {
    reviewing: id => reviewer.reviewing(id),
    isReview: chat => reviewer.isReview(chat)
  })
  const mcp = createSystemMcp({
    engineToken: token,
    port,
    bots: () => store.list(),
    tools,
    changes: new SystemChanges(database),
    instructions: 'LilBot memory tools.',
    gate
  })
  const engineApi = createEngineApi(memory, token, port, { botExists: id => store.exists(id), adapterVersion: MEMORY_ADAPTER_VERSION, reviewer })
  let memoryCalls = 0
  const adapterVersions = new Set<string>()
  const server = Bun.serve({
    port,
    hostname: '127.0.0.1',
    fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname === '/engine/lilbot/mcp') return mcp(request)
      memoryCalls++
      adapterVersions.add(request.headers.get('x-lilbot-adapter-version') ?? 'none')
      return engineApi(request, pathname)
    }
  })
  return {
    database,
    store,
    memory,
    queue,
    bots,
    reviewer,
    server,
    stopCalls,
    memoryCalls: () => memoryCalls,
    adapterVersions
  }
}
