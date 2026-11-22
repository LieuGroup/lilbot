import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ActivityEvent } from '../shared/activity-schema'
import type { EventFrame } from '../shared/protocol'
import { ActivityService } from './activity/activity-service'
import { ActivityStore } from './activity/activity-store'
import { createConnections } from './app-connections'
import { createGoals } from './app-goals'
import { createMemory } from './app-memory'
import { createThreads } from './app-threads'
import { createWebhooks, webhookMessages } from './app-webhooks'
import { createWork, giveFrom } from './app-work'
import { AttachmentService } from './attachments/attachment-service'
import { AttachmentStore } from './attachments/attachment-store'
import { backgroundTask } from './background'
import { combineTurnNotes } from './bots/bot-conversations'
import { BotPrefsStore } from './bots/bot-prefs-store'
import { BotService } from './bots/bot-service'
import { BotStore } from './bots/bot-store'
import { chatKinds, hiddenChats, sessionRoots } from './bots/hidden-chats'
import { Workspaces } from './bots/workspaces'
import { ComputerService } from './computers/computer-service'
import { ComputerStore } from './computers/computer-store'
import { loadServerKey } from './computers/server-key'
import { CodingSwitchNotice } from './connections/coding-switch-notice'
import { CALLBACK_PATH } from './connections/mcp-callback'
import { isT3Enabled, t3Connection } from './connections/t3-connection'
import { T3Grants } from './connections/t3-grant'
import { openDatabase } from './database/database'
import { deployNotice } from './deploy/deploy-notice'
import { createDevices } from './devices/device-service'
import type { BotEngine } from './engines/bot-engine'
import { GoalStore } from './goals/goal-store'
import { HistoryService } from './history/history-service'
import { HistoryStore } from './history/history-store'
import { createEngineApi, engineToken } from './http/engine-api'
import { LibraryService } from './library/library-service'
import { LibraryStore } from './library/library-store'
import { RoutineScheduler } from './routines/routine-scheduler'
import { RoutineService, routineSettings } from './routines/routine-service'
import { RoutineStore } from './routines/routine-store'
import { SkillsService } from './skills/skills-service'
import { SystemChanges } from './system/system-changes'
import { systemNote } from './system/system-note-facts'
import { createSystemServer } from './system/system-server'
import { CallingChats } from './threads/calling-chats'
import { ThreadStore } from './threads/thread-store'
import { WebhookStore } from './webhooks/webhook-store'
import { WorkCheckStore } from './work/work-check-store'

/** Construct services and their background tasks independently of the HTTP listeners. */
export function createAppServices(
  engine: BotEngine,
  settings: {
    DATA_DIR: string
    WORKSPACES_DIR: string
    PORT: number
    MEMORY_ADAPTER_VERSION: string
    /** The running release. */
    COMMIT: string
    /** The helper door's public origin, where webhook addresses point. */
    HOOK_ORIGIN: string | undefined
    /** The Access door's hostname: services' sign-ins return there. */
    ACCESS_HOST: string | undefined
    /** Whether GET `/api/connections/callback` is mounted on the Access door. */
    ACCESS_CALLBACK_ENABLED?: boolean
    T3_ENABLED?: boolean
    publish: (frame: EventFrame) => void
    botsChanged: () => void
  }
) {
  const { DATA_DIR, WORKSPACES_DIR, PORT, MEMORY_ADAPTER_VERSION, COMMIT, HOOK_ORIGIN, ACCESS_HOST, publish, botsChanged } = settings
  const t3Enabled = settings.T3_ENABLED ?? isT3Enabled(process.env)
  const repeat = (name: string, interval: number, run: () => unknown | Promise<unknown>) => setInterval(backgroundTask(name, run), interval)
  const workspaces = new Workspaces(WORKSPACES_DIR)
  const database = openDatabase(join(DATA_DIR, 'lilbot.db'))
  const activity = new ActivityService(new ActivityStore(database), botsChanged)
  const mem = createMemory(database)
  const memory = mem.memory
  const memoryChanged = () => publish({ event: 'memory.changed' })
  const token = engineToken(DATA_DIR)
  const store = new BotStore(database)
  const rootOf = sessionRoots(engine, store)
  const threadStore = new ThreadStore(database, rootOf)
  const computers = new ComputerService(
    new ComputerStore(database),
    loadServerKey(DATA_DIR),
    id => store.exists(id),
    id => workspaces.pathFor(id),
    () => publish({ event: 'computers.changed' }),
    id => store.get(id)?.permissionMode
  )
  repeat('computers', 1000, () => computers.tick())
  const devices = createDevices(database, computers, publish)
  const routineStore = new RoutineStore(database)
  const libraryStore = new LibraryStore(database)
  const webhookStore = new WebhookStore(database)
  const checkStore = new WorkCheckStore(database)
  const ownChat = (chat: string) => routineStore.isRoutineChat(chat) || threadStore.isInternal(chat) || webhookStore.isWebhookChat(chat) || checkStore.isCheckChat(chat)
  const chatKind = chatKinds(rootOf, ownChat)
  const hiddenChat = hiddenChats(chatKind)
  const library = new LibraryService(
    libraryStore,
    id => workspaces.pathFor(id),
    id => store.exists(id),
    botId => publish({ event: 'library.changed', botId })
  )
  const attachments = new AttachmentService(
    new AttachmentStore(database),
    id => workspaces.pathFor(id),
    id => store.exists(id),
    (chatId, message) => publish({ event: 'chat', chatId, data: { type: 'user.message', ...message } })
  )
  const skills = new SkillsService(process.env.LILBOT_SKILLS_DIR ?? join(homedir(), 'lilbot', 'skills'), database, () => {
    publish({ event: 'skills.changed' })
    botsChanged()
  })
  const t3Grants = new T3Grants(join(DATA_DIR, 't3-grant.json'), () => publish({ event: 'connections.changed' }))
  const prefs = new BotPrefsStore(database)
  const facts = { store, workspaces, computers, t3: () => t3Grants.status(), t3Enabled, commit: COMMIT, dataDir: DATA_DIR }
  const history = new HistoryService(
    new HistoryStore(database),
    engine,
    async () => {
      await bots.listBots()
      return store.list().filter(b => b.engineId === engine.id)
    },
    (bot, session) => store.exists(bot) && !hiddenChat(bot, session),
    (botId, chatId, rows) => devices.mergeRows(botId, rows).map(row => ({ ...row, item: attachments.mergeItem(botId, chatId, row.item) })),
    botId => publish({ event: 'history.changed', botId })
  )
  repeat('history', 1000, () => history.tick())
  const messages = webhookMessages(database, { store, prefs, history: history.store, activity, bots: () => bots }, publish)
  const codingSwitch = new CodingSwitchNotice(join(DATA_DIR, 'coding-switch.json'))
  const t3For = (botId: string) => (t3Enabled ? [t3Connection(`http://127.0.0.1:${PORT}`, token, botId, t3Grants.generation())] : [])
  const bots = new BotService(engine, store, prefs, workspaces, memory, {
    skills,
    history,
    turnNotes: combineTurnNotes(messages, codingSwitch),
    cleanupBot: botId => {
      history.store.forget(botId)
      devices.forgetBot(botId)
      routineStore.forgetBot(botId)
      webhookStore.forgetBot(botId)
      computers.forgetBot(botId)
      activity.forgetBot(botId)
      mem.forgetBot(botId)
      links.forgetBot(botId)
      goals.forgetBot(botId)
      mcp.services.forgetBot(botId)
      codingSwitch.forgetBot(botId)
    },
    changed: botsChanged,
    memoryChanged,
    memoryConnection: { url: `http://127.0.0.1:${PORT}`, tokenFile: join(DATA_DIR, 'engine-token') },
    connections: botId => [...t3For(botId), system.connection(botId), ...mcp.connections(botId)],
    onConnectionsChanged: botId => mcp.applyBot(botId),
    systemNote: systemNote(facts)
  })
  const calls = new CallingChats()
  const observeRun = (event: ActivityEvent) => {
    if (store.exists(event.botId)) activity.observe(event)
  }
  const { webhooks, webhookRuns, gates } = createWebhooks({ webhookStore, messages, bots, rootOf, calls, token, origin: HOOK_ORIGIN, t3Enabled, observeRun, publish, repeat })
  const runs = { threadStore, routineStore, webhookStore, rootOf, goalStore: new GoalStore(database), reviewModel: mem.reviewModel }
  const workDeps = { database, engine, store, prefs, bots, ...runs, libraryStore, workspaces, activity, history: history.store, calls, publish }
  const { work, links, answers, checks, checkSessions } = createWork(workDeps)
  const redirectUri = ACCESS_HOST ? `https://${ACCESS_HOST}${CALLBACK_PATH}` : undefined
  const connBase = { database, dataDir: DATA_DIR, port: PORT, engineToken: token, redirectUri, callbackEnabled: settings.ACCESS_CALLBACK_ENABLED ?? false, t3Enabled }
  const connBots = { engine, store, prefs, bots, activity, history: history.store, hiddenChat, calls, codingSwitch }
  const connGates = { t3Grants, t3Refusal: gates.t3Refusal, serviceRefusal: gates.serviceRefusal(checkSessions) }
  const mcp = createConnections({ ...connBase, ...connBots, ...connGates, publish, repeat })
  const threadDeps = { engine, store, prefs, bots, workspaces, history, activity, threadStore, calls, work: links, memory, library, root: WORKSPACES_DIR, rootOf, publish }
  const { threads, delegation } = createThreads({ ...threadDeps, botsChanged, memoryChanged })
  const routines = new RoutineService(routineStore, bots, () => publish({ event: 'routines.changed' }), routineSettings(process.env))
  const { goals, boards } = createGoals({ goalStore: runs.goalStore, work, answers, threads, routines, activity, store, publish, repeat })
  const giveFile = giveFrom(library, calls, threadStore, routineStore, webhookStore, rootOf)
  const core = { ...facts, bots, activity, memory, memoryChanged, skills, delegation, work, goals, routines, giveFile, library }
  const extra = { webhooks, webhookRuns, connections: mcp.services, calls, checkSessions, changes: new SystemChanges(database), engineToken: token, port: PORT }
  const system = createSystemServer({ ...core, ...extra })
  repeat('threads', 1000, () => threads.tick())
  repeat('work answers', 1000, () => answers.tick())
  repeat('work checks', 1000, () => checks.tick())
  const routineScheduler = new RoutineScheduler(routines, observeRun)
  repeat('routines', 1000, () => routineScheduler.tick())
  const reviewer = mem.startReviewer(bots, store, repeat)

  const apiCore = { history, computers, bots, skills, routines, library, threads, reviewer, checkpointStore: mem.checkpointStore }
  const apiHooks = { chatKind, adapterVersion: MEMORY_ADAPTER_VERSION, deploymentNotice: () => deployNotice(DATA_DIR), botExists: (id: string) => store.exists(id) }
  const engineApi = createEngineApi(memory, token, PORT, { ...apiCore, ...apiHooks, onMemoryChanged: memoryChanged, inCheck: checkSessions.refusal, ...gates })
  return { bots, store, skills, library, computers, devices, attachments, t3Grants, mcp, system, engineApi, activity, routines, threads, boards, webhooks, hiddenChat }
}
