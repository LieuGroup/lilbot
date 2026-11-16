/** Dedicated loopback listener; no static files, engine endpoints, proxy, or browser socket. */
import { HelperFrame } from '../../shared/computer-schema'
import { Registration } from '../computers/computer-auth'
import type { ComputerService } from '../computers/computer-service'

export function startPublicDoor(computers: ComputerService, port: number) {
  const door = Bun.serve<{ id: string; disconnect?: () => void }>({
    hostname: '127.0.0.1',
    port,
    maxRequestBodySize: 8192,
    async fetch(request, server) {
      const url = new URL(request.url)
      const headers = { 'Cache-Control': 'no-store' }
      if (url.search || request.headers.has('origin')) return new Response('Forbidden', { status: 403, headers })
      if (url.pathname === '/helper/register' && request.method === 'POST') {
        try {
          const input = Registration.parse(await request.json())
          return Response.json(computers.auth.register(input), { headers })
        } catch {
          return new Response('Registration refused', { status: 403, headers })
        }
      }
      if (url.pathname === '/helper/connect' && request.method === 'GET') {
        const id = computers.auth.authenticate(request)
        if (!id) return new Response('Authentication refused', { status: 403, headers })
        if (server.upgrade(request, { data: { id } })) return undefined
        return new Response('WebSocket required', { status: 400, headers })
      }
      return new Response('Not found', { status: 404, headers })
    },
    websocket: {
      maxPayloadLength: 8_100_000,
      open(socket) {
        // Key can be revoked between upgrade and open.
        if (!computers.store.key(socket.data.id)) return socket.close(1008)
        socket.data.disconnect = computers.connect(
          socket.data.id,
          frame => socket.send(frame),
          () => socket.close(1008)
        )
      },
      message(socket, message) {
        if (!computers.store.key(socket.data.id)) return socket.close(1008)
        try {
          const frame = HelperFrame.parse(JSON.parse(String(message)))
          if (frame.type === 'heartbeat') computers.heartbeat(socket.data.id)
          else computers.result(socket.data.id, frame.id, frame.result, frame.final)
        } catch {
          socket.close(1008)
        }
      },
      close(socket) {
        socket.data.disconnect?.()
      }
    }
  })
  return door
}
