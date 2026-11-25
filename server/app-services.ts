import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ActivityEvent } from '../shared/activity-schema'
import { ActivityService } from './activity/activity-service'
import { ActivityStore } from './activity/activity-store'
import { botBusyReason } from './app-bot-busy'
import { createConnections } from './app-connections'
import { createGoals } from './app-goals'
import { createMemory } from './app-memory'
import { createNotifications } from './app-notifications'
import { createRemoteWorkers, remoteWorkAnswers } from './app-remote-workers'
import { type AppServicesSettings, createSessionGrants } from './app-session-grants'
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
import { isT3Enabled, T3_TOOLS, t3Connection } from './connections/t3-connection'
import { T3Grants } from './connections/t3-grant'
import { openDatabase } from './database/database'
import { deployNotice } from './deploy/deploy-notice'
import { createDevices } from './devices/device-service'
import type { BotEngine } from './engines/bot-engine'
import { asEngineRegistry, type EngineRegistry } from './engines/engine-registry'
import { GoalStore } from './goals/goal-store'
import { HistoryService } from './history/history-service'
import { HistoryStore } from './history/history-store'
import { engineToken } from './http/engine-api'
import { LibraryService } from './library/library-service'
import { LibraryStore } from './library/library-store'
import { checkpointConnectionFor } from './memory/memory-checkpoint-key'
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
export function createAppServices(engineOrRegistry: BotEngine | EngineRegistry, settings: AppServicesSettings) {
  const engines = asEngineRegistry(engineOrRegistry)
  const { DATA_DIR, WORKSPACES_DIR, PORT, MEMORY_ADAPTER_VERSION, COMMIT, HOOK_ORIGIN, ACCESS_HOST, publish, botsChanged } = settings
  const t3Enabled = settings.T3_ENABLED ?? isT3Enabled(process.env)
  const repeat = (name: string, interval: number, run: () => unknown | Promise<unknown>) => setInterval(backgroundTask(name, run), interval)
  const workspaces = new Workspaces(WORKSPACES_DIR)
  const database = openDatabase(join(DATA_DIR, 'lilbot.db'))
  const activity = new ActivityService(new ActivityStore(database), botsChanged)
  const memoryChanged = () => publish({ event: 'memory.changed' })
  const token = engineToken(DATA_DIR)
  const store = new BotStore(database)
  const changes = new SystemChanges(database)
  const mem = createMemory(database, { deploymentNotice: () => deployNotice(DATA_DIR), publish })
  const { memory } = mem
  const rootOf = sessionRoots(engines, store)
  const threadStore = new ThreadStore(database, rootOf)
  const botAlive = (id: string) => store.exists(id)
  const wsPath = (id: string) => workspaces.pathFor(id)
  const isMainChat = (botId: string, chatId: string) => prefs.mainChat(botId) === chatId
  const computers = new ComputerService(
    new ComputerStore(database),
    loadServerKey(DATA_DIR),
    botAlive,
    wsPath,
    () => publish({ event: 'computers.changed' }),
    id => store.get(id)?.permissionMode
  )
  repeat('computers', 1000, () => computers.tick())
  const devices = createDevices(database, computers, publish)
  const [routineStore, libraryStore, webhookStore, checkStore, prefs] = [
    new RoutineStore(database),
    new LibraryStore(database),
    new WebhookStore(database),
    new WorkCheckStore(database),
    new BotPrefsStore(database)
  ]
  const observesActivity = (botId: string) => engines.observesActivity(store.engineId(botId))
  const notif = createNotifications({ database, devices, store, dataDir: DATA_DIR, isMainChat, observesActivity, publish, sender: settings.notificationSender })
  repeat('notifications prune', 60 * 60_000, () => notif.prune())
  const sessionGrants = createSessionGrants(database, token, rootOf, isMainChat, () => system.sessionConnections)
  const ownChat = sessionGrants.ownChat({ routineStore, threadStore, webhookStore, checkStore, mem })
  const chatKind = chatKinds(rootOf, ownChat)
  const hiddenChat = hiddenChats(chatKind)
  const library = new LibraryService(libraryStore, wsPath, botAlive, botId => publish({ event: 'library.changed', botId }))
  const attachments = new AttachmentService(new AttachmentStore(database), wsPath, botAlive, (chatId, message) =>
    publish({ event: 'chat', chatId, data: { type: 'user.message', ...message } })
  )
  const skills = new SkillsService(process.env.LILBOT_SKILLS_DIR ?? join(homedir(), 'lilbot', 'skills'), database, () => {
    publish({ event: 'skills.changed' })
    botsChanged()
  })
  const t3Grants = new T3Grants(join(DATA_DIR, 't3-grant.json'), () => publish({ event: 'connections.changed' }))
  const facts = { store, workspaces, computers, t3: () => t3Grants.status(), t3Enabled, commit: COMMIT, dataDir: DATA_DIR }
  const history = new HistoryService(
    new HistoryStore(database, () => botsChanged()),
    engines,
    async () => {
      await bots.listBots()
      return store.list().filter(b => engines.has(b.engineId))
    },
    (bot, session) => store.exists(bot) && !hiddenChat(bot, session),
    (botId, chatId, rows) => devices.mergeRows(botId, rows).map(row => ({ ...row, item: attachments.mergeItem(botId, chatId, row.item) })),
    botId => publish({ event: 'history.changed', botId })
  )
  repeat('history', 1000, () => history.tick())
  const messages = webhookMessages(database, { store, prefs, history: history.store, activity, bots: () => bots }, publish)
  const codingSwitch = new CodingSwitchNotice(join(DATA_DIR, 'coding-switch.json'))
  const t3For = (botId: string) => (t3Enabled ? [t3Connection(`http://127.0.0.1:${PORT}`, token, botId, t3Grants.generation())] : [])
  const memoryConnection = (botId: string) => checkpointConnectionFor(`http://127.0.0.1:${PORT}`, token, botId)
  const bots = new BotService(engines, store, prefs, workspaces, memory, {
    skills,
    history,
    turnNotes: combineTurnNotes(messages, codingSwitch, mem.turnContext),
    memoryContext: mem.turnContext,
    conversationHooks: notif.conversationHooks(mem.conversationHooks(chatKind), hiddenChat),
    cleanupBot: botId => {
      history.store.forget(botId)
      remoteWorkers.runner.stopForBot(botId)
      sessionGrants.revokeForBot(botId)
      for (const s of [devices, routineStore, webhookStore, computers, activity, mem, links, goals, mcp.services, codingSwitch, notif]) s.forgetBot(botId)
    },
    changed: botsChanged,
    memoryChanged,
    memoryConnection,
    skillConnection: { url: `http://127.0.0.1:${PORT}`, tokenFile: join(DATA_DIR, 'engine-token') },
    connections: botId => [...t3For(botId), system.connection(botId), ...mcp.connections(botId)],
    onConnectionsChanged: botId => mcp.applyBot(botId),
    systemNote: systemNote(facts),
    busyReason: botBusyReason({ database, activity, routineStore, webhookStore }),
    readOnlyChat: (botId, chatId) => webhookRuns.callers.isKnownLimited(botId, chatId)
  })
  const calls = new CallingChats(undefined, { namer: botId => engines.namer(store.engineId(botId)), services: () => mcp.serviceTools(), t3Tools: T3_TOOLS })
  const observeRun = (event: ActivityEvent) => store.exists(event.botId) && activity.observe(event)
  const hookDeps = { webhookStore, messages, bots, rootOf, calls, token, origin: HOOK_ORIGIN, t3Enabled, narrowed: threadStore, isMainChat, sessionGrants }
  const { webhooks, webhookRuns, gates } = createWebhooks({ ...hookDeps, observeRun, publish, repeat })
  const runs = { threadStore, routineStore, webhookStore, rootOf, goalStore: new GoalStore(database), reviewModel: mem.reviewModel }
  const remoteWork = remoteWorkAnswers(threadStore, () => ({
    computerOnline: id => computers.list().some(c => c.id === id && c.online && !c.keyConflict),
    oscarAnswer: (id, reqId, text) => threads.oscarAnswer(id, reqId, text),
    changed: () => threads.changed(),
    stopByChat: (botId, chatId) => remoteWorkers.runner.stopByChat(botId, chatId)
  }))
  const workDeps = { database, engine: engines, store, prefs, bots, ...runs, libraryStore, workspaces, activity, history: history.store, calls, publish, remoteWork, sessionGrants }
  const { work, links, answers, checks, checkSessions } = createWork({ ...workDeps, onStatus: notif.onWorkStatus })
  const redirectUri = ACCESS_HOST ? `https://${ACCESS_HOST}${CALLBACK_PATH}` : undefined
  const connBase = { database, dataDir: DATA_DIR, port: PORT, engineToken: token, redirectUri, callbackEnabled: settings.ACCESS_CALLBACK_ENABLED ?? false, t3Enabled }
  const connBots = { engines, store, prefs, bots, activity, history: history.store, hiddenChat, calls, codingSwitch, t3Grants }
  const mcp = createConnections({ ...connBase, ...connBots, t3Refusal: gates.t3Refusal, serviceRefusal: gates.serviceRefusal(checkSessions), publish, repeat })
  const rwDeps = { database, computers, store, memory, skills, computersChanged: () => publish({ event: 'computers.changed' }) }
  const remoteWorkers = createRemoteWorkers({ ...rwDeps, handleMcp: (ctx, body) => system.workerMcp(ctx, body) })
  const threadCore = { engine: engines, store, prefs, bots, workspaces, history, activity, threadStore, calls, work: links, callers: webhookRuns.callers, sessionGrants, t3Enabled }
  const { threads, delegation } = createThreads({ ...threadCore, memory, library, root: WORKSPACES_DIR, rootOf, remoteWorkers, publish, botsChanged, memoryChanged })
  const routines = new RoutineService(routineStore, bots, () => publish({ event: 'routines.changed' }), routineSettings(process.env))
  const { goals, boards } = createGoals({ goalStore: runs.goalStore, work, answers, threads, routines, activity, store, publish, onWaiting: notif.onGoalWaiting, repeat })
  const giveFile = giveFrom(library, calls, threadStore, routineStore, webhookStore, rootOf)
  const core = { ...facts, bots, activity, memory, memoryChanged, history, skills, delegation, work, goals, routines, giveFile, library }
  const sysExtra = { webhooks, webhookRuns, connections: mcp.services, calls, checkSessions, changes, grants: sessionGrants.grants, reviewTracker: sessionGrants.reviewTracker }
  const system = createSystemServer({
    ...core,
    ...sysExtra,
    t3Forward: mcp.t3Bridge.forBot,
    engineToken: token,
    port: PORT,
    workerAllowMemory: id => threadStore.allowsWorkerMemory(id)
  })
  const routineScheduler = new RoutineScheduler(routines, observeRun)
  for (const [name, fn] of [
    ['threads', () => threads.tick()],
    ['work answers', () => answers.tick()],
    ['work checks', () => checks.tick()],
    ['routines', () => routineScheduler.tick()]
  ] as const)
    repeat(name, 1000, fn)
  const reviewer = mem.startReviewer(bots, store, repeat, sessionGrants.prepareReview)
  const apiCore = { history, bots, skills, routines, library, threads, reviewer, changes, chatKind, adapterVersion: MEMORY_ADAPTER_VERSION, botExists: botAlive, store, rootOf }
  const apiAccess = { mainChat: (id: string) => prefs.mainChat(id), isLimited: (b: string, c: string) => webhookRuns.callers.isKnownLimited(b, c) }
  const apiChecks = { inCheck: sessionGrants.inCheck(checkSessions), skillWriteLocked: sessionGrants.skillWriteLocked, ...gates }
  const { engineApi, checkpointChoices } = mem.wireEngineApi(engines, token, PORT, { ...apiCore, ...apiAccess, ...apiChecks })
  const base = { bots, store, skills, library, computers, remoteWorkers, devices, attachments, t3Grants, mcp, system, engineApi, memoryConnection }
  return { ...base, checkpointChoices, activity, routines, threads, boards, webhooks, hiddenChat, notifications: notif.notifications }
}
