/** Dedicated loopback listener; no static files, engine endpoints, proxy, or browser socket. */

import { HelperFrame } from '../../shared/computer-schema'
import { Registration } from '../computers/computer-auth'
import type { ComputerService } from '../computers/computer-service'
import { connectionBudget, plainServerError } from './listener-safety'

export function startPublicDoor(computers: ComputerService, port: number) {
  const allowed = connectionBudget()
  const door = Bun.serve<{ id: string; nonce: string; disconnect?: () => void }>({
    development: false,
    error: plainServerError,
    hostname: '127.0.0.1',
    port,
    maxRequestBodySize: 8192,
    async fetch(request, server) {
      try {
        const url = new URL(request.url)
        const headers = { 'Cache-Control': 'no-store' }
        if (url.search || request.headers.has('origin')) return new Response('Forbidden', { status: 403, headers })
        if (!allowed(request.headers.get('cf-connecting-ip') ?? server.requestIP(request)?.address ?? 'unknown')) return new Response('Too many requests', { status: 429, headers })
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
          if (server.upgrade(request, { data: { id, nonce: request.headers.get('x-lilbot-nonce')! } })) return undefined
          return new Response('WebSocket required', { status: 400, headers })
        }
        return new Response('Not found', { status: 404, headers })
      } catch {
        return plainServerError()
      }
    },
    websocket: {
      maxPayloadLength: 8_100_000,
      open(socket) {
        // Key can be revoked between upgrade and open.
        if (!computers.store.key(socket.data.id)) return socket.close(1008)
        socket.send(JSON.stringify(computers.auth.serverKey.proof(socket.data.id, socket.data.nonce)))
        let sequence = 0
        socket.data.disconnect = computers.connect(
          socket.data.id,
          frame => socket.send(computers.auth.serverKey.frame(socket.data.id, socket.data.nonce, sequence++, frame)),
          (code = 1008) => socket.close(code)
        )
      },
      message(socket, message) {
        if (!computers.store.key(socket.data.id)) return socket.close(1008)
        if (!computers.isPeer(socket.data.id, socket.data.disconnect)) return socket.close(4001)
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
