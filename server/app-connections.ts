/** Builds LilBot's connections and connects them to the bots, their engine and the listeners: the T3 Code bridge and the
 *  MCP services bots add (#187), with the services' forwarding route (private listener), the sign-in callback (Access door
 *  only) and the watchers that apply sign-in changes to every bot. */
import type { Database } from 'bun:sqlite'
import { join } from 'node:path'
import type { EventFrame } from '../shared/protocol'
import { backgroundTask } from './background'
import type { BotPrefsStore } from './bots/bot-prefs-store'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import { ConnectionApplier } from './connections/connection-apply'
import { connectionCallback } from './connections/mcp-callback'
import { McpConnectionStore } from './connections/mcp-connection-store'
import { McpConnections } from './connections/mcp-connections'
import { McpCredentials } from './connections/mcp-credentials'
import { createServiceForward } from './connections/mcp-forward'
import { engineGeneration, serviceConnections } from './connections/mcp-service-connection'
import { SIGN_IN_WINDOW_MS, SignInFlows } from './connections/mcp-sign-in'
import { TokenKeeper } from './connections/mcp-token-keeper'
import { createT3Bridge } from './connections/t3-bridge'
import { T3_DEFAULT_MCP_URL } from './connections/t3-connection'
import type { T3Grants } from './connections/t3-grant'
import { watchT3SignIn } from './connections/t3-watch'
import { connectionLine } from './devices/origin-line'
import type { BotEngine } from './engines/bot-engine'
import type { CallingChats } from './threads/calling-chats'

interface ConnectionDeps {
  database: Database
  dataDir: string
  port: number
  engineToken: string
  /** LilBot's sign-in return address on the Access door; without the door no sign-in can start. */
  redirectUri: string | undefined
  engine: BotEngine
  store: BotStore
  prefs: BotPrefsStore
  bots: BotService
  calls: CallingChats
  t3Grants: T3Grants
  publish: (frame: EventFrame) => void
  repeat: (name: string, interval: number, run: () => unknown) => unknown
}

/** A dev server with the test data folder and a bot allowlist may shorten the ten minutes (`check:connections`). */
function signInWindow(env: Record<string, string | undefined>): number {
  const test = env.LILBOT_DATA_DIR && env.LILBOT_BOT_IDS && env.LILBOT_CONNECTION_TEST_SIGN_IN_SECONDS
  return test ? Math.max(1, Number(test)) * 1000 : SIGN_IN_WINDOW_MS
}

export function createConnections({ database, dataDir, port, engineToken, redirectUri, engine, store, prefs, bots, calls, t3Grants, publish, repeat }: ConnectionDeps) {
  const published = () => publish({ event: 'connections.changed' })
  const botIds = () => store.list().map(bot => bot.id)
  // A sign-in from `bun run t3:sign-in`, an expiry or a revocation changes which tools bots should see.
  watchT3SignIn(t3Grants, published, () => bots.refreshConnections())
  const rows = new McpConnectionStore(database)
  const credentials = new McpCredentials(join(dataDir, 'mcp-credentials.json'))
  const soon = () =>
    setTimeout(
      backgroundTask('connections', () => applier.tick()),
      0
    )
  const services = new McpConnections(
    rows,
    credentials,
    new SignInFlows(signInWindow(process.env)),
    {
      botName: id => store.get(id).name,
      botExists: id => store.exists(id),
      callingChat: (botId, requestId) => calls.find(botId, 'lilbot_connection', requestId),
      signedIn: (botId, chatId, name, runId) => applier.signedIn(botId, chatId, name, runId),
      changed: soon
    },
    redirectUri
  )
  const applier: ConnectionApplier = new ConnectionApplier(
    {
      bots: () => store.list().filter(bot => bot.engineId === engine.id),
      mainChat: id => prefs.mainChat(id),
      refresh: () => bots.refreshConnections(),
      apply: async (engineBotId, chatIds) => (await engine.applyConnections?.(engineBotId, chatIds)) ?? chatIds.map(chatId => ({ chatId, state: 'not_open' as const })),
      tell: (botId, chatId, prompt, runId) => bots.runRoutine(botId, prompt, { runId, chatId, hiddenInput: true, onChat: () => {}, origin: { line: connectionLine } })
    },
    () => engineGeneration(services),
    () => JSON.stringify(services.list()),
    published
  )
  applier.start()
  repeat('connections', 1000, () => applier.tick())
  const lilbotUrl = `http://127.0.0.1:${port}`
  return {
    services,
    t3Bridge: createT3Bridge({ upstream: process.env.LILBOT_T3_MCP_URL ?? T3_DEFAULT_MCP_URL, grants: t3Grants, engineToken, port, botIds }),
    forward: createServiceForward({ services, store: rows, credentials, keeper: new TokenKeeper(credentials), engineToken, port, botIds }),
    callback: connectionCallback(services),
    connections: (botId: string) => serviceConnections(services, lilbotUrl, engineToken, botId)
  }
}
