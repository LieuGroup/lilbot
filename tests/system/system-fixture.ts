import { join } from 'node:path'
/** LilBot's MCP server over the in-memory fake engine: real services, real database, no network. */
import { giveFrom } from '../../server/app-work'
import { chatKinds, hiddenChats } from '../../server/bots/hidden-chats'
import { Workspaces } from '../../server/bots/workspaces'
import type { ComputerService } from '../../server/computers/computer-service'
import { connectionKey } from '../../server/connections/connection-keys'
import { McpConnectionStore } from '../../server/connections/mcp-connection-store'
import { McpConnections } from '../../server/connections/mcp-connections'
import { McpCredentials } from '../../server/connections/mcp-credentials'
import { SignInFlows } from '../../server/connections/mcp-sign-in'
import type { BotEngine } from '../../server/engines/bot-engine'
import { GoalService } from '../../server/goals/goal-service'
import { HistoryService } from '../../server/history/history-service'
import { HistoryStore } from '../../server/history/history-store'
import { LibraryService } from '../../server/library/library-service'
import { LibraryStore } from '../../server/library/library-store'
import { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { SkillsService } from '../../server/skills/skills-service'
import { SystemChanges } from '../../server/system/system-changes'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import { createSystemServer } from '../../server/system/system-server'
import { CallingChats } from '../../server/threads/calling-chats'
import { DelegationControl } from '../../server/threads/delegation-control'
import { DelegationService } from '../../server/threads/delegation-service'
import { ThreadService } from '../../server/threads/thread-service'
import { ThreadStore } from '../../server/threads/thread-store'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import { WebhookMessages } from '../../server/webhooks/webhook-messages'
import { WebhookService } from '../../server/webhooks/webhook-service'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { checkSessions } from '../../server/work/check-sessions'
import type { T3ConnectionStatus } from '../../shared/connections-schema'
import { fakeService } from '../helpers/fake-engine'
import { groupHostFor } from '../threads/delegation-fixture'
import { workFixture } from '../work/work-fixture'

const TOKEN = 'engine-token-for-tests'
const PORT = 3997
const COMMIT = 'abcdef0123456789abcdef0123456789abcdef01'

const DEFAULT_COMPUTERS = [
  { id: 'leader', name: 'leader-box', os: 'linux', online: true, lastSeen: 1700000000000, keyConflict: false, main: false },
  { id: 'mac', name: 'MacBook', os: 'darwin', online: false, lastSeen: 1700000000000, keyConflict: false, main: true }
]
type FixtureOpts = { t3Enabled?: boolean; makeComputers?: (fake: ReturnType<typeof fakeService>, workspaces: Workspaces) => ComputerService }

export function systemFixture({ t3Enabled = false, makeComputers }: FixtureOpts = {}) {
  const fake = fakeService()
  const state = { memoryPushes: 0, t3: { state: 'connected', expiresAt: Date.now() + 86_400_000 } as T3ConnectionStatus }
  const changes = new SystemChanges(fake.database)
  const webhookStore = new WebhookStore(fake.database)
  const routineStore = new RoutineStore(fake.database)
  const threadStore = new ThreadStore(fake.database)
  const webhooks = new WebhookService(webhookStore, fake.service, TOKEN, 'https://door.example')
  const workspaces = new Workspaces(fake.root)
  const computers = makeComputers?.(fake, workspaces) ?? ({ list: () => DEFAULT_COMPUTERS } as unknown as ComputerService)
  const host = {
    requireBot: (id: string) => fake.service.requireBot(id),
    listBots: () => fake.service.listBots(),
    runRoutine: fake.service.runRoutine.bind(fake.service),
    folder: (id: string) => workspaces.ensure(id)
  }
  const routines = new RoutineService(
    routineStore,
    fake.service,
    () => {},
    undefined,
    () => 1_700_000_000_000
  )
  /** The engine's report of each call: the conversation each bot's calls come from (default: its main one), and the
   *  compression continuations (a session to the one it began as; null: unreadable). */
  const calls = new CallingChats(300)
  const from = new Map<string, string>()
  const roots = new Map<string, string | null>()
  const rootOf = (_bot: string, chat: string) => (roots.has(chat) ? roots.get(chat)! : chat)
  const work = workFixture({ database: fake.database, requireBot: id => fake.service.requireBot(id), calls })
  const threads = new ThreadService(threadStore, host, undefined, undefined, undefined, groupHostFor(fake.root, work.links).host)
  const library = new LibraryService(
    new LibraryStore(fake.database),
    id => workspaces.pathFor(id),
    id => fake.store.exists(id)
  )
  const skills = new SkillsService(join(fake.root, 'skills'), fake.database)
  const giveFile = giveFrom(library, calls, threadStore, routineStore, webhookStore, rootOf)
  // Which calls come from webhook runs' sessions, and the messages runs left (shown in the main conversation).
  const shown: { botId: string; runId: string; source: string; text: string }[] = []
  const webhookRuns = {
    callers: webhookCallers(webhookStore, rootOf, calls),
    messages: new WebhookMessages(fake.database, async (botId, runId, source, text) => shown.push({ botId, runId, source, text }) > 0),
    callingChat: (botId: string, requestId: string) => calls.find(botId, 'lilbot_webhook_message', requestId)
  }
  const goals = new GoalService(
    work.goalStore,
    work.work,
    { waiting: () => {}, tell: (id, goal, prompt) => work.answers.notify(id, goal.id, goal.botId, prompt), changed: () => {} },
    60
  )
  const history = new HistoryStore(fake.database)
  const reviewChats = new Set<string>()
  const ownChat = (chat: string) =>
    routineStore.isRoutineChat(chat) || threadStore.isInternal(chat) || webhookStore.isWebhookChat(chat) || work.work.checks.isCheckChat(chat) || reviewChats.has(chat)
  const hiddenChat = hiddenChats(chatKinds(rootOf, ownChat))
  const historyService = new HistoryService(
    history,
    {} as BotEngine,
    async () => [],
    (bot, session) => fake.store.exists(bot) && !hiddenChat(bot, session)
  )
  const signedIn: { botId: string; chatId: string; name: string }[] = []
  const connections = new McpConnections(
    new McpConnectionStore(fake.database),
    new McpCredentials(join(fake.root, 'mcp-credentials.json')),
    new SignInFlows(),
    {
      botName: id => fake.store.get(id).name,
      botExists: id => fake.store.exists(id),
      callingChat: (botId, requestId) => calls.find(botId, 'lilbot_connection', requestId),
      userSentInChat: (botId, chatId, text) => history.hasUserMessageContaining(botId, chatId, text),
      signedIn: (botId, chatId, name) => signedIn.push({ botId, chatId, name }),
      changed: () => {}
    },
    'https://bot.example.com/api/connections/callback'
  )
  const server = createSystemServer({
    store: fake.store,
    workspaces,
    computers,
    t3: () => state.t3,
    t3Enabled,
    commit: COMMIT,
    bots: fake.service,
    activity: fake.activity,
    memory: fake.memory,
    memoryChanged: () => state.memoryPushes++,
    history: historyService,
    skills,
    delegation: { hand: new DelegationService(threads, host, async botId => `${botId}-main`, work.links), control: new DelegationControl(threads, host), groups: threads.groups! },
    work: work.work,
    routines,
    goals,
    giveFile,
    library,
    webhooks,
    connections,
    calls,
    checkSessions: checkSessions(work.work.checks, rootOf),
    webhookRuns,
    changes,
    dataDir: fake.root,
    engineToken: TOKEN,
    port: PORT
  })
  const request = (message: unknown, headers: Record<string, string>, method = 'POST') =>
    server.handler(
      new Request(`http://127.0.0.1:${PORT}/engine/lilbot/mcp`, {
        method,
        headers: { host: `127.0.0.1:${PORT}`, ...headers },
        body: method === 'POST' ? JSON.stringify(message) : undefined
      })
    )
  const as = (botId: string) => ({ authorization: `Bearer ${connectionKey(TOKEN, SYSTEM_KEY_PURPOSE, botId)}` })
  const rpc = (botId: string, method: string, params?: unknown, headers: Record<string, string> = {}) =>
    request({ jsonrpc: '2.0', id: 1, method, params }, { ...as(botId), ...headers })
  /** The decoded answer of a tool call: its JSON data, or the refusal text. Unless `reported` is false the engine reports
   *  the call starting in the bot's conversation (`from`) first, as Hermes does. */
  async function call(botId: string, name: string, args: Record<string, unknown> = {}, reported = true) {
    if (reported) calls.saw(botId, from.get(botId) ?? `${botId}-main`, `mcp__lilbot_system__${name}`, args, crypto.randomUUID())
    const result = (await (await rpc(botId, 'tools/call', { name, arguments: args })).json()).result
    const text: string = result.content[0].text
    if (result.isError) return { error: text }
    const data = JSON.parse(text)
    // LilBot's refusals are ordinary results, so Hermes does not pause the server after three of them.
    return typeof data?.refused === 'string' ? { error: data.refused as string } : { data }
  }
  const refs = { state, changes, threads, work, goals, routines, routineStore, webhookStore, workspaces, library, skills }
  const runtime = { calls, from, roots, reviewChats, webhooks, connections, history, historyService, signedIn, webhookRuns, shown }
  return { ...fake, ...server, ...refs, ...runtime, rosterPushes: fake.changes, request, as, rpc, call }
}

/** A second bot in the roster. */
export async function addBot(f: ReturnType<typeof systemFixture>, name: string) {
  return f.service.createBot({ name, function: `${name} does things`, instructions: '' })
}
