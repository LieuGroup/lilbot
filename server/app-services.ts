import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ActivityEvent } from '../shared/activity-schema'
import type { EventFrame } from '../shared/protocol'
import { ActivityService } from './activity/activity-service'
import { ActivityStore } from './activity/activity-store'
import { createGoals } from './app-goals'
import { createThreads } from './app-threads'
import { createWork, giveFrom } from './app-work'
import { AttachmentService } from './attachments/attachment-service'
import { AttachmentStore } from './attachments/attachment-store'
import { backgroundTask } from './background'
import { BotPrefsStore } from './bots/bot-prefs-store'
import { BotService } from './bots/bot-service'
import { BotStore } from './bots/bot-store'
import { hiddenChats, sessionRoots } from './bots/hidden-chats'
import { Workspaces } from './bots/workspaces'
import { ComputerService } from './computers/computer-service'
import { ComputerStore } from './computers/computer-store'
import { loadServerKey } from './computers/server-key'
import { createT3Bridge } from './connections/t3-bridge'
import { T3_DEFAULT_MCP_URL, t3Connection } from './connections/t3-connection'
import { T3Grants } from './connections/t3-grant'
import { watchT3SignIn } from './connections/t3-watch'
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
import { MemoryReviewer, reviewSettingsFrom } from './memory/memory-reviewer'
import { MemoryService } from './memory/memory-service'
import { MemoryStore } from './memory/memory-store'
import { ReviewQueue } from './memory/review-queue'
import { RoutineScheduler } from './routines/routine-scheduler'
import { RoutineService, routineSettings } from './routines/routine-service'
import { RoutineStore } from './routines/routine-store'
import { SkillsService } from './skills/skills-service'
import { SystemChanges } from './system/system-changes'
import { systemNote } from './system/system-note-facts'
import { createSystemServer } from './system/system-server'
import { CallingChats } from './threads/calling-chats'
import { ThreadStore } from './threads/thread-store'
import { WebhookService } from './webhooks/webhook-service'
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
    publish: (frame: EventFrame) => void
    botsChanged: () => void
  }
) {
  const { DATA_DIR, WORKSPACES_DIR, PORT, MEMORY_ADAPTER_VERSION, COMMIT, HOOK_ORIGIN, publish, botsChanged } = settings
  const repeat = (name: string, interval: number, run: () => unknown | Promise<unknown>) => setInterval(backgroundTask(name, run), interval)
  const workspaces = new Workspaces(WORKSPACES_DIR)
  const database = openDatabase(join(DATA_DIR, 'lilbot.db'))
  const activity = new ActivityService(new ActivityStore(database), botsChanged)
  const memory = new MemoryService(new MemoryStore(database))
  const memoryChanged = () => publish({ event: 'memory.changed' })
  const token = engineToken(DATA_DIR)
  const store = new BotStore(database)
  const threadStore = new ThreadStore(database)
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
  const reviewQueue = new ReviewQueue(database)
  const routineStore = new RoutineStore(database)
  const libraryStore = new LibraryStore(database)
  const webhookStore = new WebhookStore(database)
  const rootOf = sessionRoots(engine, store)
  const checkStore = new WorkCheckStore(database)
  const ownChat = (chat: string) => routineStore.isRoutineChat(chat) || threadStore.isInternal(chat) || webhookStore.isWebhookChat(chat) || checkStore.isCheckChat(chat)
  const hiddenChat = hiddenChats(rootOf, ownChat)
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
  // Every bot gets the shared T3 sign-in and the t3-coding skill.
  const t3Grants = new T3Grants(join(DATA_DIR, 't3-grant.json'), () => publish({ event: 'connections.changed' }))
  const prefs = new BotPrefsStore(database)
  const facts = { store, workspaces, computers, t3: () => t3Grants.status(), commit: COMMIT, dataDir: DATA_DIR }
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
  const bots = new BotService(engine, store, prefs, workspaces, memory, {
    skills,
    history,
    cleanupBot: botId => {
      history.store.forget(botId)
      devices.forgetBot(botId)
      routineStore.forgetBot(botId)
      webhookStore.forgetBot(botId)
      computers.forgetBot(botId)
      activity.forgetBot(botId)
      reviewQueue.forgetBot(botId)
      links.forgetBot(botId)
      goals.forgetBot(botId)
    },
    changed: botsChanged,
    memoryChanged,
    memoryConnection: { url: `http://127.0.0.1:${PORT}`, tokenFile: join(DATA_DIR, 'engine-token') },
    connections: botId => [t3Connection(`http://127.0.0.1:${PORT}`, token, botId, t3Grants.generation()), system.connection(botId)],
    systemNote: systemNote(facts)
  })
  const calls = new CallingChats()
  const runs = { threadStore, routineStore, webhookStore, rootOf, goalStore: new GoalStore(database), reviewModel: reviewSettingsFrom(process.env).model ?? null }
  const workDeps = { database, engine, store, prefs, bots, ...runs, libraryStore, workspaces, activity, history: history.store, calls, publish }
  const { work, links, answers, checks, checkSessions } = createWork(workDeps)
  const threadDeps = { engine, store, prefs, bots, workspaces, history, activity, threadStore, calls, work: links, memory, library, root: WORKSPACES_DIR, rootOf, publish }
  const { threads, delegation } = createThreads({ ...threadDeps, botsChanged, memoryChanged })
  const routines = new RoutineService(routineStore, bots, () => publish({ event: 'routines.changed' }), routineSettings(process.env))
  const { goals, boards } = createGoals({ goalStore: runs.goalStore, work, answers, threads, routines, activity, store, publish, repeat })
  const giveFile = giveFrom(library, calls, threadStore, routineStore, webhookStore, rootOf)
  const webhooks = new WebhookService(webhookStore, bots, token, HOOK_ORIGIN, () => publish({ event: 'webhooks.changed' }))
  const deps = { ...facts, bots, activity, memory, memoryChanged, delegation, work, goals, routines, giveFile, webhooks, calls, checkSessions }
  const system = createSystemServer({ ...deps, changes: new SystemChanges(database), engineToken: token, port: PORT })
  watchT3SignIn(
    t3Grants,
    () => publish({ event: 'connections.changed' }),
    () => bots.refreshConnections()
  )
  const botIds = () => store.list().map(bot => bot.id)
  const t3Bridge = createT3Bridge({ upstream: process.env.LILBOT_T3_MCP_URL ?? T3_DEFAULT_MCP_URL, grants: t3Grants, engineToken: token, port: PORT, botIds })
  repeat('threads', 1000, () => threads.tick())
  repeat('work answers', 1000, () => answers.tick())
  repeat('work checks', 1000, () => checks.tick())
  const observeRun = (event: ActivityEvent) => {
    if (store.exists(event.botId)) activity.observe(event)
  }
  const routineScheduler = new RoutineScheduler(routines, observeRun)
  repeat('routines', 1000, () => routineScheduler.tick())
  const webhookScheduler = new RoutineScheduler(webhooks, observeRun)
  repeat('webhooks', 1000, () => webhookScheduler.tick())
  const reviewer = new MemoryReviewer(reviewQueue, bots, reviewSettingsFrom(process.env), Date.now, id => store.exists(id))
  repeat('memory reviewer', 20_000, () => reviewer.tick())

  const engineApi = createEngineApi(memory, token, PORT, {
    history,
    computers,
    deploymentNotice: () => deployNotice(DATA_DIR),
    bots,
    skills,
    routines,
    library,
    threads,
    botExists: id => store.exists(id),
    onMemoryChanged: memoryChanged,
    adapterVersion: MEMORY_ADAPTER_VERSION,
    reviewer,
    hiddenChat,
    memoryRefusal: checkSessions.memoryRefusal
  })
  return { bots, store, skills, library, computers, devices, attachments, t3Grants, t3Bridge, system, engineApi, activity, routines, threads, boards, webhooks, hiddenChat }
}
