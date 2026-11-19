import { checkPublicPort, isTunnelRequest, plainServerError } from './http/listener-safety'
/** LilBot server: serves the built web app and answers the browser's `/ws` requests through the bot engine.
 *  Binds to loopback only; reach it from other devices through the tailnet (`tailscale serve`). */

import { homedir } from 'node:os'
import { join } from 'node:path'
import type { WebSocketHandler } from 'bun'
import { ActivityService } from './activity/activity-service'
import { ActivityStore } from './activity/activity-store'
import { BotPrefsStore } from './bots/bot-prefs-store'
import { BotService } from './bots/bot-service'
import { BotStore } from './bots/bot-store'
import { Workspaces } from './bots/workspaces'
import { ComputerService } from './computers/computer-service'
import { ComputerStore } from './computers/computer-store'
import { loadServerKey } from './computers/server-key'
import { createT3Bridge } from './connections/t3-bridge'
import { T3_BRIDGE_PATH, T3_DEFAULT_MCP_URL, t3Connection } from './connections/t3-connection'
import { T3Grants } from './connections/t3-grant'
import { openDatabase } from './database/database'
import { HermesEngine } from './engines/hermes/hermes-engine'
import { MEMORY_ADAPTER_VERSION } from './engines/hermes/hermes-memory-setup'
import { startAccessDoor } from './http/access-door'
import { accessSettings } from './http/access-settings'
import { appRoutes, type SocketData } from './http/app-routes'
import { BrowserSession } from './http/browser-session'
import { createEngineApi, engineToken } from './http/engine-api'
import { startPublicDoor } from './http/public-door'
import { allowedHosts } from './http/socket-guard'
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
import { files } from './skills/skill-files'
import { SkillsService } from './skills/skills-service'
import { ThreadService } from './threads/thread-service'
import { ThreadStore } from './threads/thread-store'

const PORT = Number(process.env.LILBOT_PORT ?? 3370)
const PUBLIC_PORT = Number(process.env.LILBOT_PUBLIC_PORT ?? 3372)
if (process.env.LILBOT_PUBLIC_ENABLED === '1') checkPublicPort(PUBLIC_PORT, PORT)
const ACCESS = accessSettings(process.env, PORT, PUBLIC_PORT)
const HOST = process.env.LILBOT_HOST ?? '127.0.0.1'
/** LilBot's own database file lives here. */
const DATA_DIR = process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot')
/** Each bot's workspace folder is created under here. */
const WORKSPACES_DIR = process.env.LILBOT_WORKSPACES_DIR ?? join(homedir(), 'lilbot', 'workspaces')
/** Every connected browser is subscribed to this topic. */
const EVERYONE = 'everyone'
const CHANGE_DELAY_MS = 300
const publish = (topic: string, data: string) => {
  server.publish(topic, data)
  accessServer?.publish(topic, data)
}

// Several changes in a row (or a burst of engine events) become one "fetch the bot list again".
let changeTimer: ReturnType<typeof setTimeout> | undefined
function botsChanged() {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => publish(EVERYONE, JSON.stringify({ event: 'bots.changed' })), CHANGE_DELAY_MS)
}

const engine = new HermesEngine(process.env.LILBOT_BOT_IDS?.split(',').filter(Boolean))
const database = openDatabase(join(DATA_DIR, 'lilbot.db'))
const activity = new ActivityService(new ActivityStore(database), botsChanged)
const memory = new MemoryService(new MemoryStore(database))
const memoryChanged = () => publish(EVERYONE, JSON.stringify({ event: 'memory.changed' }))
const token = engineToken(DATA_DIR)
const store = new BotStore(database)
const threadStore = new ThreadStore(database)
const computers = new ComputerService(
  new ComputerStore(database),
  loadServerKey(DATA_DIR),
  id => store.exists(id),
  id => new Workspaces(WORKSPACES_DIR).pathFor(id),
  () => publish(EVERYONE, JSON.stringify({ event: 'computers.changed' })),
  id => store.get(id)?.permissionMode
)
setInterval(() => computers.tick(), 1000)
const routineStore = new RoutineStore(database)
const library = new LibraryService(
  new LibraryStore(database),
  id => new Workspaces(WORKSPACES_DIR).pathFor(id),
  id => store.exists(id),
  botId => publish(EVERYONE, JSON.stringify({ event: 'library.changed', botId }))
)
const skills = new SkillsService(process.env.LILBOT_SKILLS_DIR ?? join(homedir(), 'lilbot', 'skills'), database, () => {
  publish(EVERYONE, JSON.stringify({ event: 'skills.changed' }))
  botsChanged()
})
// Coding goes to T3 Code: every bot gets its tools through LilBot's bridge and one shared sign-in
// (`bun run t3:sign-in`), and the coding instructions as the LilBot skill `t3-coding` (installed below).
const t3Grants = new T3Grants(join(DATA_DIR, 't3-grant.json'), () => publish(EVERYONE, JSON.stringify({ event: 'connections.changed' })))
const prefs = new BotPrefsStore(database)
const bots = new BotService(engine, store, prefs, new Workspaces(WORKSPACES_DIR), memory, {
  skills,
  cleanupBot: botId => {
    routineStore.forgetBot(botId)
    computers.forgetBot(botId)
    activity.forgetBot(botId)
    new ReviewQueue(database).forgetBot(botId)
  },
  changed: botsChanged,
  memoryChanged,
  memoryConnection: { url: `http://127.0.0.1:${PORT}`, tokenFile: join(DATA_DIR, 'engine-token') },
  connections: botId => [t3Connection(`http://127.0.0.1:${PORT}`, token, botId, t3Grants.generation())]
})
// A sign-in from `bun run t3:sign-in`, an expiry or a revocation changes which tools bots should see.
let t3Generation = t3Grants.generation()
setInterval(() => {
  const next = t3Grants.generation()
  if (next === t3Generation) return
  t3Generation = next
  publish(EVERYONE, JSON.stringify({ event: 'connections.changed' }))
  void bots.refreshConnections()
}, 5_000)
const t3Bridge = createT3Bridge({
  upstream: process.env.LILBOT_T3_MCP_URL ?? T3_DEFAULT_MCP_URL,
  grants: t3Grants,
  engineToken: token,
  port: PORT,
  botIds: () => store.list().map(bot => bot.id)
})
const routines = new RoutineService(routineStore, bots, () => publish(EVERYONE, JSON.stringify({ event: 'routines.changed' })), {
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
  () => threadEvents(threadStore, store, prefs, frame => publish(EVERYONE, JSON.stringify(frame))),
  (d, working) => {
    for (const botId of [d.sender, d.target])
      if (store.exists(botId)) activity.observe({ botId, chatId: `thread:${d.id}`, key: `${d.id}:${working}:${Date.now()}`, status: working ? 'working' : 'finished' })
  }
)
setInterval(() => threads.tick(), 1000)
const scheduler = new RoutineScheduler(routines, event => {
  if (store.exists(event.botId)) activity.observe(event)
})
setInterval(() => scheduler.tick(), 1000)
/** Engine adapters on this machine reach memory here; see `engine-api.ts`. */

// The after-chat memory review. LILBOT_REVIEW=off disables it; LILBOT_REVIEW_MODEL is
// "provider::model" (without it a review runs on the bot's own model, which costs more).
const [reviewProvider, reviewModel] = (process.env.LILBOT_REVIEW_MODEL ?? '').split('::')
const reviewer = new MemoryReviewer(
  new ReviewQueue(database),
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
setInterval(() => reviewer.tick(), 20_000)

// Every bot uses LilBot's memory: bots on an older adapter are updated, and a bot that is not
// connected yet is connected. Both take effect from the bot's next session.
async function prepareMemory() {
  // Temporary test servers must opt in: never rewrite real profiles' memory endpoints.
  await bots.prepareRuntimes()
  if (process.env.LILBOT_SKIP_MEMORY_SETUP === '1') return
  const updated = await engine.refreshMemory(
    store
      .list()
      .filter(bot => bot.engineId === engine.id)
      .map(bot => bot.engineBotId)
  )
  if (updated.length) console.log(`Memory adapter updated to ${MEMORY_ADAPTER_VERSION} for: ${updated.join(', ')}`)
  const connected = await bots.connectAllMemory()
  if (connected.length) console.log(`Connected to LilBot memory: ${connected.join(', ')}`)
}
prepareMemory().catch(error => console.error('[memory] could not prepare memory for the bots:', error instanceof Error ? error.message : error))

const engineApi = createEngineApi(memory, token, PORT, {
  computers,
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
engine.onBotsChanged(botsChanged)
bots.watchActivity(event => {
  if (!threadStore.isInternal(event.chatId)) activity.observe(event)
}, activity.cursor)
const DIST = join(import.meta.dir, '..', 'dist')

const ALLOWED_HOSTS = allowedHosts(PORT, process.env.LILBOT_ALLOWED_HOSTS)

const websocket: WebSocketHandler<SocketData> = {
  open(socket) {
    socket.subscribe(EVERYONE)
    socket.data.session = new BrowserSession(
      bots,
      frame => {
        // A send after the browser left is expected and harmless.
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
      },
      activity,
      routines,
      library,
      threads,
      () => ({ t3: t3Grants.status() }),
      computers
    )
  },
  message(socket, message) {
    void socket.data.session?.handle(typeof message === 'string' ? message : message.toString())
  },
  close(socket) {
    socket.data.session?.close()
  }
}

const browserRoutes = appRoutes(library, DIST, ALLOWED_HOSTS, 'hermes')
const server = Bun.serve<SocketData>({
  development: false,
  error: plainServerError,
  port: PORT,
  hostname: HOST,
  async fetch(request, server) {
    try {
      if (isTunnelRequest(request)) return new Response('Forbidden', { status: 403 })
      const url = new URL(request.url)
      if (url.pathname === T3_BRIDGE_PATH) {
        server.timeout(request, 0)
        return t3Bridge(request)
      }
      if (url.pathname.startsWith('/engine/')) return engineApi(request, url.pathname)
      return await browserRoutes(request, server)
    } catch {
      return plainServerError()
    }
  },
  websocket
})
const accessServer = ACCESS ? startAccessDoor(ACCESS, appRoutes(library, DIST, new Set([ACCESS.host]), 'hermes'), websocket) : undefined

try {
  skills.provide('t3-coding', files(join(import.meta.dir, 'connections', 't3-coding-skill')))
} catch (error) {
  console.error('[skills] could not install the t3-coding skill:', error instanceof Error ? error.message : error)
}

console.log(`LilBot listening on http://${server.hostname}:${server.port} (engine: Hermes)`)

// Off until the dedicated tunnel is provisioned. Never target the private app port.
if (process.env.LILBOT_PUBLIC_ENABLED === '1') startPublicDoor(computers, PUBLIC_PORT)
