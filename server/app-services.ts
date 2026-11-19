import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EventFrame } from '../shared/protocol'
import { ActivityService } from './activity/activity-service'
import { ActivityStore } from './activity/activity-store'
import { AttachmentService } from './attachments/attachment-service'
import { AttachmentStore } from './attachments/attachment-store'
import { backgroundTask } from './background'
import { BotPrefsStore } from './bots/bot-prefs-store'
import { BotService } from './bots/bot-service'
import { BotStore } from './bots/bot-store'
import { Workspaces } from './bots/workspaces'
import { ComputerService } from './computers/computer-service'
import { ComputerStore } from './computers/computer-store'
import { loadServerKey } from './computers/server-key'
import { createT3Bridge } from './connections/t3-bridge'
import { T3_DEFAULT_MCP_URL, t3Connection } from './connections/t3-connection'
import { T3Grants } from './connections/t3-grant'
import { openDatabase } from './database/database'
import { deployNotice } from './deploy/deploy-notice'
import type { BotEngine } from './engines/bot-engine'
import { HistoryService } from './history/history-service'
import { HistoryStore } from './history/history-store'
import { createEngineApi, engineToken } from './http/engine-api'
import { threadEvents } from './http/thread-events'
import { LibraryService } from './library/library-service'
import { LibraryStore } from './library/library-store'
import { defaultReviewSettings, MemoryReviewer } from './memory/memory-reviewer'
import { MemoryService } from './memory/memory-service'
import { MemoryStore } from './memory/memory-store'
import { ReviewQueue } from './memory/review-queue'
import { RoutineScheduler } from './routines/routine-scheduler'
import { defaultRoutineSettings, RoutineService } from './routines/routine-service'
import { RoutineStore } from './routines/routine-store'
import { SkillsService } from './skills/skills-service'
import { ThreadService } from './threads/thread-service'
import { ThreadStore } from './threads/thread-store'

/** Construct services and their background tasks independently of the HTTP listeners. */
export function createAppServices(
  engine: BotEngine,
  settings: {
    DATA_DIR: string
    WORKSPACES_DIR: string
    PORT: number
    MEMORY_ADAPTER_VERSION: string
    publish: (frame: EventFrame) => void
    botsChanged: () => void
  }
) {
  const { DATA_DIR, WORKSPACES_DIR, PORT, MEMORY_ADAPTER_VERSION, publish, botsChanged } = settings
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
  const reviewQueue = new ReviewQueue(database)
  const routineStore = new RoutineStore(database)
  const library = new LibraryService(
    new LibraryStore(database),
    id => workspaces.pathFor(id),
    id => store.exists(id),
    botId => publish({ event: 'library.changed', botId })
  )
  const attachments = new AttachmentService(
    new AttachmentStore(database),
    id => workspaces.pathFor(id),
    id => store.exists(id),
    (chatId, message) => {
      publish({ event: 'chat', chatId, data: { type: 'user.message', ...message } })
    }
  )
  const skills = new SkillsService(process.env.LILBOT_SKILLS_DIR ?? join(homedir(), 'lilbot', 'skills'), database, () => {
    publish({ event: 'skills.changed' })
    botsChanged()
  })
  // Every bot gets the shared T3 sign-in and the t3-coding skill.
  const t3Grants = new T3Grants(join(DATA_DIR, 't3-grant.json'), () => publish({ event: 'connections.changed' }))
  const prefs = new BotPrefsStore(database)
  const history = new HistoryService(
    new HistoryStore(database),
    engine,
    async () => {
      await bots.listBots()
      return store.list().filter(b => b.engineId === engine.id)
    },
    (bot, session) => store.exists(bot) && !routineStore.isRoutineChat(session) && !threadStore.isInternal(session),
    (botId, chatId, rows) => rows.map(row => ({ ...row, item: attachments.merge({ botId, chatId, title: '', workspace: '', running: false, items: [row.item] }).items[0] })),
    botId => publish({ event: 'history.changed', botId })
  )
  repeat('history', 1000, () => history.tick())
  const bots = new BotService(engine, store, prefs, workspaces, memory, {
    skills,
    history,
    cleanupBot: botId => {
      history.store.forget(botId)
      routineStore.forgetBot(botId)
      computers.forgetBot(botId)
      activity.forgetBot(botId)
      reviewQueue.forgetBot(botId)
    },
    changed: botsChanged,
    memoryChanged,
    memoryConnection: { url: `http://127.0.0.1:${PORT}`, tokenFile: join(DATA_DIR, 'engine-token') },
    connections: botId => [t3Connection(`http://127.0.0.1:${PORT}`, token, botId, t3Grants.generation())]
  })
  // A sign-in from `bun run t3:sign-in`, an expiry or a revocation changes which tools bots should see.
  let t3Generation = t3Grants.generation()
  setInterval(
    backgroundTask('connections watcher', async () => {
      const next = t3Grants.generation()
      if (next === t3Generation) return
      publish({ event: 'connections.changed' })
      await bots.refreshConnections()
      t3Generation = next
    }),
    5_000
  )
  const t3Bridge = createT3Bridge({
    upstream: process.env.LILBOT_T3_MCP_URL ?? T3_DEFAULT_MCP_URL,
    grants: t3Grants,
    engineToken: token,
    port: PORT,
    botIds: () => store.list().map(bot => bot.id)
  })
  const routines = new RoutineService(routineStore, bots, () => publish({ event: 'routines.changed' }), {
    ...defaultRoutineSettings,
    // Only isolated servers with their own data folder and explicit profile allowlist may shorten it.
    minIntervalSeconds:
      process.env.LILBOT_DATA_DIR && process.env.LILBOT_BOT_IDS && process.env.LILBOT_ROUTINE_TEST_INTERVAL_SECONDS
        ? Math.max(1, Number(process.env.LILBOT_ROUTINE_TEST_INTERVAL_SECONDS))
        : defaultRoutineSettings.minIntervalSeconds
  })
  const threads = new ThreadService(
    threadStore,
    bots,
    () =>
      threadEvents(threadStore, store, prefs, publish, (botId, chatId, item, at) => {
        if (store.exists(botId)) history.store.reference(botId, chatId, item, at)
      }),
    (d, working) => {
      for (const botId of [d.sender, d.target])
        if (store.exists(botId)) activity.observe({ botId, chatId: `thread:${d.id}`, key: `${d.id}:${working}:${Date.now()}`, status: working ? 'working' : 'finished' })
    }
  )
  repeat('threads', 1000, () => threads.tick())
  const scheduler = new RoutineScheduler(routines, event => {
    if (store.exists(event.botId)) activity.observe(event)
  })
  repeat('routines', 1000, () => scheduler.tick())
  // The after-chat memory review. LILBOT_REVIEW=off disables it; LILBOT_REVIEW_MODEL is
  // "provider::model" (without it a review runs on the bot's own model, which costs more).
  const [reviewProvider, reviewModel] = (process.env.LILBOT_REVIEW_MODEL ?? '').split('::')
  const reviewer = new MemoryReviewer(
    reviewQueue,
    bots,
    {
      ...defaultReviewSettings,
      enabled: process.env.LILBOT_REVIEW !== 'off',
      turns: Number(process.env.LILBOT_REVIEW_TURNS ?? defaultReviewSettings.turns),
      quietMs: Number(process.env.LILBOT_REVIEW_QUIET_SECONDS ?? defaultReviewSettings.quietMs / 1000) * 1000,
      model: reviewProvider && reviewModel ? { provider: reviewProvider, model: reviewModel } : undefined
    },
    Date.now,
    id => store.exists(id)
  )
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
    reviewer
  })
  return { bots, store, skills, threadStore, library, computers, attachments, t3Grants, t3Bridge, engineApi, activity, routines, threads }
}
