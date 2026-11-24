/** Builds LilBot's connections and connects them to the bots, their engine and the listeners: the T3 Code bridge and the
 *  MCP services bots add (#187), with the services' forwarding route (private listener), the sign-in callback (Access door
 *  only) and the watchers that apply sign-in changes to every bot. */
import type { Database } from 'bun:sqlite'
import { join } from 'node:path'
import type { T3ConnectionStatus } from '../shared/connections-schema'
import type { EventFrame } from '../shared/protocol'
import type { ActivityService } from './activity/activity-service'
import { backgroundTask } from './background'
import type { BotPrefsStore } from './bots/bot-prefs-store'
import type { BotService } from './bots/bot-service'
import type { BotStore } from './bots/bot-store'
import type { CodingSwitchNotice } from './connections/coding-switch-notice'
import { ConnectionApplier, cancelledPrompt, failedPrompt } from './connections/connection-apply'
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
import type { EngineRegistry } from './engines/engine-registry'
import type { HistoryStore } from './history/history-store'
import type { BrowserConnections } from './http/connection-handlers'
import type { CallingChats } from './threads/calling-chats'

interface ConnectionDeps {
  database: Database
  dataDir: string
  port: number
  engineToken: string
  /** LilBot's sign-in return address on the Access door; without the door no sign-in can start. */
  redirectUri: string | undefined
  /** Whether GET `/api/connections/callback` is mounted on the Access door. */
  callbackEnabled: boolean
  engines: EngineRegistry
  store: BotStore
  prefs: BotPrefsStore
  bots: BotService
  activity: ActivityService
  history: HistoryStore
  hiddenChat: (botId: string, chatId: string) => boolean
  calls: CallingChats
  codingSwitch: CodingSwitchNotice
  t3Enabled?: boolean
  t3Grants: T3Grants
  t3Refusal: (botId: string, tool: string, args: unknown) => Promise<string | null>
  serviceRefusal: (botId: string, tool: string, args: unknown) => Promise<string | null>
  publish: (frame: EventFrame) => void
  repeat: (name: string, interval: number, run: () => unknown) => unknown
}

/** A dev server with the test data folder and a bot allowlist may shorten the ten minutes (`check:connections`). */
function signInWindow(env: Record<string, string | undefined>): number {
  const test = env.LILBOT_DATA_DIR && env.LILBOT_BOT_IDS && env.LILBOT_CONNECTION_TEST_SIGN_IN_SECONDS
  return test ? Math.max(1, Number(test)) * 1000 : SIGN_IN_WINDOW_MS
}

export function createConnections({
  database,
  dataDir,
  port,
  engineToken,
  redirectUri,
  callbackEnabled,
  engines,
  store,
  prefs,
  bots,
  activity,
  history,
  hiddenChat,
  calls,
  codingSwitch,
  t3Enabled,
  t3Grants,
  t3Refusal,
  serviceRefusal,
  publish,
  repeat
}: ConnectionDeps) {
  const published = () => publish({ event: 'connections.changed' })
  const botIds = () => store.list().map(bot => bot.id)
  const toolName = (server: string, tool: string, botId?: string) => engines.mcpToolName(botId && store.exists(botId) ? store.get(botId).engineId : undefined, server, tool)
  // A sign-in from `bun run t3:sign-in`, an expiry or a revocation changes which tools bots should see.
  if (t3Enabled) watchT3SignIn(t3Grants, published, () => bots.refreshConnections())
  const [rows, credentials] = [new McpConnectionStore(database), new McpCredentials(join(dataDir, 'mcp-credentials.json'))]
  const tickApplier = backgroundTask('connections', () => applier.tick())
  const soon = () => setTimeout(tickApplier, 0)
  const services = new McpConnections(
    rows,
    credentials,
    new SignInFlows(signInWindow(process.env)),
    {
      botName: id => store.get(id).name,
      botExists: id => store.exists(id),
      callingChat: (botId, requestId) => calls.find(botId, 'lilbot_connection', requestId),
      isHiddenChat: hiddenChat,
      userSentInChat: (botId, chatId, text) => history.hasUserMessageContaining(botId, chatId, text),
      signedIn: (botId, chatId, name, runId) => applier.signedIn(botId, chatId, name, runId),
      signInCancelled: (botId, chatId, name, runId) => {
        applier.tell(botId, chatId, cancelledPrompt(name), runId)
        soon()
      },
      signInFailed: (botId, chatId, name, reason, runId) => {
        applier.tell(botId, chatId, failedPrompt(name, reason), runId)
        soon()
      },
      cardChanged: card => {
        if (!store.exists(card.botId) || hiddenChat(card.botId, card.chatId)) return
        history.signInCard(card.botId, card.chatId, card)
        publish({ event: 'chat', chatId: card.chatId, data: { type: 'connection.sign_in', card } })
        publish({ event: 'history.changed', botId: card.botId })
      },
      changed: soon,
      toolName
    },
    redirectUri,
    Date.now,
    callbackEnabled
  )
  const applier: ConnectionApplier = new ConnectionApplier(
    {
      bots: () => store.list().filter(bot => engines.has(bot.engineId)),
      mainChat: id => prefs.mainChat(id),
      refresh: () => bots.refreshConnections(),
      apply: async (engineBotId, chatIds, engineId) =>
        (await (engineId ? engines.get(engineId) : engines.defaultEngine)?.applyConnections?.(engineBotId, chatIds)) ??
        chatIds.map(chatId => ({ chatId, state: 'not_open' as const })),
      tell: (botId, chatId, prompt, runId) => bots.runRoutine(botId, prompt, { runId, chatId, hiddenInput: true, onChat: () => {}, origin: { line: connectionLine } })
    },
    () => engineGeneration(services),
    () => JSON.stringify(services.list()),
    published
  )
  applier.start()
  repeat('connections', 1000, () => {
    services.reconcileSignInCards()
    return applier.tick()
  })
  const lilbotUrl = `http://127.0.0.1:${port}`
  return {
    services,
    t3Bridge: createT3Bridge({ upstream: process.env.LILBOT_T3_MCP_URL ?? T3_DEFAULT_MCP_URL, grants: t3Grants, engineToken, port, botIds, refusal: t3Refusal }),
    forward: createServiceForward({
      services,
      store: rows,
      credentials,
      keeper: new TokenKeeper(credentials),
      engineToken,
      port,
      botIds,
      refusal: serviceRefusal,
      toolName
    }),
    callback: connectionCallback(services),
    browser: (t3: () => T3ConnectionStatus): BrowserConnections => ({
      status: () => ({ t3: t3(), services: services.list() }),
      ready: (botId, chatId) => applier.ready(botId, chatId),
      reconcile: () => services.reconcileSignInCards(),
      openSignIn: cardId => services.openSignIn(cardId),
      finishSignIn: (cardId, address) => services.finishSignInCard(cardId, address),
      cancelSignIn: cardId => services.cancelSignIn(cardId),
      restartSignIn: cardId => services.restartSignIn(cardId)
    }),
    applyBot: (botId: string) => {
      applier.applyBot(botId)
      soon()
    },
    onCodingSkillsReady: (removedT3Skill: boolean) => {
      const grant = t3Grants.usable()
      codingSwitch.onStartup({
        t3Enabled: Boolean(t3Enabled),
        removedT3Skill,
        t3GrantIssuedAt: grant ? grant.issuedAt : null,
        bots: botIds(),
        mainChat: id => prefs.mainChat(id),
        primaryBot: prefs.primaryBot() ?? store.list().find(bot => bot.isDefault)?.id ?? null,
        hasNotice: issuedAt => history.hasItem(`t3-switch-notice:${issuedAt}`),
        postNotice: (botId, chatId, issuedAt, detail) => {
          const at = Date.now()
          history.session(botId, chatId, at)
          history.reference(botId, chatId, { kind: 'tool', toolId: `t3-switch-notice:${issuedAt}`, name: 'coding notice', detail, running: false }, at)
          publish({ event: 'history.changed', botId })
          activity.setUnread(botId, true)
        }
      })
    },
    connections: (botId: string) => serviceConnections(services, lilbotUrl, engineToken, botId)
  }
}
