/** LeBot server: serves the built web app and answers the browser's `/ws` requests through the bot engine.
 *  Binds to loopback only; reach it from other devices through the tailnet (`tailscale serve`). */
import { join, normalize } from 'node:path'

import { ClientSession } from './client-session'
import { HermesEngine } from './engine/hermes/hermes-engine'
import { allowedHosts, socketAllowed } from './socket-guard'

interface SocketData {
  session?: ClientSession
}

const PORT = Number(process.env.LEBOT_PORT ?? 3370)
const HOST = process.env.LEBOT_HOST ?? '127.0.0.1'
const engine = new HermesEngine()
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
      socket.data.session = new ClientSession(engine, frame => {
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
