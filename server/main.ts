/** LeBot server: serves the built web app and answers the browser's `/ws` requests through the bot engine.
 *  Binds to loopback only; reach it from other devices through the tailnet (`tailscale serve`). */
import { homedir } from 'node:os'
import { join, normalize } from 'node:path'

import { BotService } from './bot-service'
import { ClientSession } from './client-session'
import { openDatabase } from './db/database'
import { PrefsStore } from './db/prefs-store'
import { HermesEngine } from './engine/hermes/hermes-engine'
import { MEMORY_ADAPTER_VERSION } from './engine/hermes/hermes-memory-setup'
import { createEngineApi, engineToken } from './engine-api'
import { MemoryService } from './memory/memory-service'
import { MemoryStore } from './memory/memory-store'
import { allowedHosts, socketAllowed } from './socket-guard'
import { Workspaces } from './workspaces'

interface SocketData {
  session?: ClientSession
}

const PORT = Number(process.env.LEBOT_PORT ?? 3370)
const HOST = process.env.LEBOT_HOST ?? '127.0.0.1'
/** LeBot's own database file lives here. */
const DATA_DIR = process.env.LEBOT_DATA_DIR ?? join(homedir(), '.local', 'share', 'lebot')
/** Each bot's workspace folder is created under here. */
const WORKSPACES_DIR = process.env.LEBOT_WORKSPACES_DIR ?? join(homedir(), 'lebot', 'workspaces')
/** Every connected browser is subscribed to this topic. */
const EVERYONE = 'everyone'
const CHANGE_DELAY_MS = 300

// Several changes in a row (or a burst of engine events) become one "fetch the bot list again".
let changeTimer: ReturnType<typeof setTimeout> | undefined
function botsChanged() {
  clearTimeout(changeTimer)
  changeTimer = setTimeout(() => server.publish(EVERYONE, JSON.stringify({ event: 'bots.changed' })), CHANGE_DELAY_MS)
}

const engine = new HermesEngine()
const database = openDatabase(join(DATA_DIR, 'lebot.db'))
const memory = new MemoryService(new MemoryStore(database))
const memoryChanged = () => server.publish(EVERYONE, JSON.stringify({ event: 'memory.changed' }))
const token = engineToken(DATA_DIR)
const bots = new BotService(engine, new PrefsStore(database), new Workspaces(WORKSPACES_DIR), memory, {
  changed: botsChanged,
  memoryChanged,
  memoryConnection: { url: `http://127.0.0.1:${PORT}`, tokenFile: join(DATA_DIR, 'engine-token') }
})
/** Engine adapters on this machine reach memory here; see `engine-api.ts`. */
const engineApi = createEngineApi(memory, token, PORT, { onMemoryChanged: memoryChanged, adapterVersion: MEMORY_ADAPTER_VERSION })
engine.onBotsChanged(botsChanged)
const DIST = join(import.meta.dir, '..', 'dist')

const ALLOWED_HOSTS = allowedHosts(PORT, process.env.LEBOT_ALLOWED_HOSTS)

async function serveStatic(pathname: string): Promise<Response> {
  const relative = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '')
  const file = Bun.file(join(DIST, relative))
  if (relative !== '/' && (await file.exists())) return new Response(file)

  const index = Bun.file(join(DIST, 'index.html'))
  if (await index.exists()) return new Response(index)
  return new Response('LeBot web app is not built. Run: bun run build', { status: 503 })
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
      socket.data.session = new ClientSession(bots, frame => {
        // A send after the browser left is expected and harmless.
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(frame))
      })
    },
    message(socket, message) {
      void socket.data.session?.handle(typeof message === 'string' ? message : message.toString())
    },
    close(socket) {
      socket.data.session?.close()
    }
  }
})

console.log(`LeBot listening on http://${server.hostname}:${server.port} (engine: Hermes)`)
