/** LilBot server: serves the built web app and answers the browser's `/ws` requests through the bot engine.
 *  Binds to loopback only; reach it from other devices through the tailnet (`tailscale serve`). */
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'
import { ActivityService } from './activity/activity-service'
import { ActivityStore } from './activity/activity-store'
import { BotPrefsStore } from './bots/bot-prefs-store'
import { BotService } from './bots/bot-service'
import { BotStore } from './bots/bot-store'
import { Workspaces } from './bots/workspaces'
import { openDatabase } from './database/database'
import { HermesEngine } from './engines/hermes/hermes-engine'
import { MEMORY_ADAPTER_VERSION } from './engines/hermes/hermes-memory-setup'
import { BrowserSession } from './http/browser-session'
import { createEngineApi, engineToken } from './http/engine-api'
import { allowedHosts, socketAllowed } from './http/socket-guard'
import { defaultReviewSettings, MemoryReviewer } from './memory/memory-reviewer'
import { MemoryService } from './memory/memory-service'
import { MemoryStore } from './memory/memory-store'
import { ReviewQueue } from './memory/review-queue'

interface SocketData {
  session?: BrowserSession
}

const PORT = Number(process.env.LILBOT_PORT ?? 3370)
const HOST = process.env.LILBOT_HOST ?? '127.0.0.1'
/** LilBot's own database file lives here. */
const DATA_DIR = process.env.LILBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lilbot')
/** Each bot's workspace folder is created under here. */
const WORKSPACES_DIR = process.env.LILBOT_WORKSPACES_DIR ?? join(homedir(), 'lilbot', 'workspaces')
/** Every connected browser is subscribed to this topic. */
const EVERYONE = 'everyone'
const CHANGE_DELAY_MS = 300

// Several changes in a row (or a burst of engine events) become one "fetch the bot list again".
let changeTimer: ReturnType<typeof setTimeout> | undefined
function botsChanged() {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => server.publish(EVERYONE, JSON.stringify({ event: 'bots.changed' })), CHANGE_DELAY_MS)
}

const engine = new HermesEngine(process.env.LILBOT_BOT_IDS?.split(',').filter(Boolean))
const database = openDatabase(join(DATA_DIR, 'lilbot.db'))
const activity = new ActivityService(new ActivityStore(database), botsChanged)
const memory = new MemoryService(new MemoryStore(database))
const memoryChanged = () => server.publish(EVERYONE, JSON.stringify({ event: 'memory.changed' }))
const token = engineToken(DATA_DIR)
const bots = new BotService(engine, new BotStore(database), new BotPrefsStore(database), new Workspaces(WORKSPACES_DIR), memory, {
  cleanupBot: botId => {
    activity.forgetBot(botId)
    new ReviewQueue(database).forgetBot(botId)
  },
  changed: botsChanged,
  memoryChanged,
  memoryConnection: { url: `http://127.0.0.1:${PORT}`, tokenFile: join(DATA_DIR, 'engine-token') }
})
/** Engine adapters on this machine reach memory here; see `engine-api.ts`. */

// The after-chat memory review. LILBOT_REVIEW=off disables it; LILBOT_REVIEW_MODEL is
// "provider::model" (without it a review runs on the bot's own model, which costs more).
const [reviewProvider, reviewModel] = (process.env.LILBOT_REVIEW_MODEL ?? '').split('::')
const reviewer = new MemoryReviewer(new ReviewQueue(database), bots, {
  ...defaultReviewSettings,
  enabled: process.env.LILBOT_REVIEW !== 'off',
  turns: Number(process.env.LILBOT_REVIEW_TURNS ?? defaultReviewSettings.turns),
  quietMs: Number(process.env.LILBOT_REVIEW_QUIET_SECONDS ?? defaultReviewSettings.quietMs / 1000) * 1000,
  model: reviewProvider && reviewModel ? { provider: reviewProvider, model: reviewModel } : undefined
})
setInterval(() => reviewer.tick(), 20_000)

// Every bot uses LilBot's memory: bots on an older adapter are updated, and a bot that is not
// connected yet is connected. Both take effect from the bot's next session.
async function prepareMemory() {
  // Temporary test servers must opt in: never rewrite real profiles' memory endpoints.
  await bots.listBots()
  if (process.env.LILBOT_SKIP_MEMORY_SETUP === '1') return
  const updated = await engine.refreshMemory()
  if (updated.length) console.log(`Memory adapter updated to ${MEMORY_ADAPTER_VERSION} for: ${updated.join(', ')}`)
  const connected = await bots.connectAllMemory()
  if (connected.length) console.log(`Connected to LilBot memory: ${connected.join(', ')}`)
}
prepareMemory().catch(error => console.error('[memory] could not prepare memory for the bots:', error instanceof Error ? error.message : error))

const engineApi = createEngineApi(memory, token, PORT, {
  bots,
  botExists: id => !new BotStore(database).deleted(id),
  onMemoryChanged: memoryChanged,
  adapterVersion: MEMORY_ADAPTER_VERSION,
  reviewer
})
engine.onBotsChanged(botsChanged)
bots.watchActivity(event => activity.observe(event), activity.cursor)
const DIST = join(import.meta.dir, '..', 'dist')

const ALLOWED_HOSTS = allowedHosts(PORT, process.env.LILBOT_ALLOWED_HOSTS)

async function serveStatic(pathname: string): Promise<Response> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = Bun.file(join(DIST, relative))
  if (relative !== '/' && (await file.exists())) return new Response(file)

  const index = Bun.file(join(DIST, 'index.html'))
  if (await index.exists()) return new Response(index)
  return new Response('LilBot web app is not built. Run: bun run build', { status: 503 })
}

const server = Bun.serve<SocketData>({
  port: PORT,
  hostname: HOST,
  async fetch(request, server) {
    const url = new URL(request.url)

    if (url.pathname === '/ws') {
      if (!socketAllowed(request, ALLOWED_HOSTS)) {
        console.error(`[server] refused a socket for host ${request.headers.get('host')}`)
        return new Response('Forbidden', { status: 403 })
      }
      if (server.upgrade(request, { data: {} })) return undefined
      return new Response('Expected a WebSocket upgrade', { status: 400 })
    }

    if (url.pathname.startsWith('/engine/')) return engineApi(request, url.pathname)
    if (url.pathname === '/api/health') return Response.json({ ok: true, engine: 'hermes' })
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })

    try {
      return await serveStatic(url.pathname)
    } catch (error) {
      console.error('[server] static file failed:', error instanceof Error ? error.message : error)
      return new Response('Not found', { status: 404 })
    }
  },
  websocket: {
    open(socket) {
      socket.subscribe(EVERYONE)
      socket.data.session = new BrowserSession(
        bots,
        frame => {
          // A send after the browser left is expected and harmless.
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
        },
        activity
      )
    },
    message(socket, message) {
      void socket.data.session?.handle(typeof message === 'string' ? message : message.toString())
    },
    close(socket) {
      socket.data.session?.close()
    }
  }
})

console.log(`LilBot listening on http://${server.hostname}:${server.port} (engine: Hermes)`)
