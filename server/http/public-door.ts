/** Dedicated loopback listener; no static files, engine endpoints, proxy, or browser socket. */

import { verifyHelperFrame } from '../../helper/frame-auth'
import { HelperFrame } from '../../shared/computer-schema'
import { Registration } from '../computers/computer-auth'
import type { ComputerService } from '../computers/computer-service'
import { payloadTurn } from '../computers/work-queue'
import { byteBudget, connectionBudget, plainServerError } from './listener-safety'

export function startPublicDoor(computers: ComputerService, port: number) {
  const allowed = connectionBudget()
  const perComputer = connectionBudget(6)
  const door = Bun.serve<{
    id: string
    nonce: string
    disconnect?: () => void
    bytes?: ReturnType<typeof byteBudget>
    messages?: ReturnType<typeof byteBudget>
    progress?: Map<string, number>
    sequence: number
    heartbeatAt: number
    queued: number
  }>({
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
        const address = request.headers.get('cf-connecting-ip') ?? server.requestIP(request)?.address ?? 'unknown'
        if (!allowed(address)) return new Response('Too many requests', { status: 429, headers })
        const claimed = request.headers.get('x-lilbot-computer')
        if (claimed && !perComputer(claimed)) return new Response('Too many requests', { status: 429, headers })
        const id = url.pathname === '/helper/connect' && request.method === 'GET' ? computers.auth.authenticate(request) : null
        if (url.pathname === '/helper/register' && request.method === 'POST') {
          try {
            const input = Registration.parse(await request.json())
            return Response.json(computers.auth.register(input), { headers })
          } catch {
            return new Response('Registration refused', { status: 403, headers })
          }
        }
        if (url.pathname === '/helper/connect' && request.method === 'GET') {
          if (!id) return new Response('Authentication refused', { status: 403, headers })
          if (server.upgrade(request, { data: { id, nonce: request.headers.get('x-lilbot-nonce')!, sequence: 0, heartbeatAt: 0, queued: 0 } })) return undefined
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
        const key = computers.store.key(socket.data.id)
        if (!key) return socket.close(4003)
        socket.data.bytes = byteBudget()
        socket.data.messages = byteBudget(24, 16)
        socket.data.progress = new Map()
        if (socket.send(JSON.stringify(computers.auth.serverKey.proof(socket.data.id, socket.data.nonce))) === 0) return socket.close(1013)
        let sequence = 0
        const send = (frame: string) => {
          const sent = socket.send(computers.auth.serverKey.frame(socket.data.id, socket.data.nonce, sequence, frame))
          if (sent === 0) {
            socket.close(1013)
            return false
          }
          // -1 is Bun's accepted-but-buffered result; zero means dropped.
          sequence++
          return true
        }
        if (computers.store.revoked(socket.data.id)) {
          send(JSON.stringify({ type: 'revoked' }))
          socket.close(4003)
          return
        }
        socket.data.disconnect = computers.connect(
          socket.data.id,
          send,
          (code = 1001) => socket.close(code),
          () => socket.getBufferedAmount() < 64_000
        )
      },
      drain(socket) {
        computers.dispatch(socket.data.id)
      },
      message(socket, message) {
        if (computers.store.revoked(socket.data.id)) return socket.close(4003)
        if (!computers.isPeer(socket.data.id, socket.data.disconnect)) return socket.close(4001)
        if (!socket.data.bytes?.(typeof message === 'string' ? Buffer.byteLength(message) : message.byteLength)) return socket.close(1009)
        if (!socket.data.messages?.(1)) return socket.close(1008)
        if (++socket.data.queued > 24) return socket.close(1008)
        void payloadTurn(() => {
          if (socket.readyState !== 1 || !computers.isPeer(socket.data.id, socket.data.disconnect) || computers.store.revoked(socket.data.id)) return
          try {
            const envelope = JSON.parse(String(message))
            if (!verifyHelperFrame(computers.store.key(socket.data.id)!, socket.data.id, socket.data.nonce, socket.data.sequence, envelope)) return socket.close(1007)
            socket.data.sequence++
            const frame = HelperFrame.parse(JSON.parse(envelope.payload))
            if (frame.type === 'heartbeat') {
              if (!frame.challenge && Date.now() - socket.data.heartbeatAt < 5000) return socket.close(1008)
              if (!frame.challenge) socket.data.heartbeatAt = Date.now()
              computers.heartbeat(socket.data.id, socket.data.disconnect, frame.challenge)
            } else {
              if (!frame.final) {
                if (frame.result.output.length > 8192 || Date.now() - (socket.data.progress!.get(frame.id) ?? 0) < 900) return socket.close(1008)
                if (socket.data.progress!.size >= 8 && !socket.data.progress!.has(frame.id)) return socket.close(1008)
                socket.data.progress!.set(frame.id, Date.now())
              } else socket.data.progress!.delete(frame.id)
              void payloadTurn(() => {
                if (computers.isPeer(socket.data.id, socket.data.disconnect) && !computers.store.revoked(socket.data.id))
                  computers.result(socket.data.id, frame.id, frame.result, frame.final)
              })
            }
          } catch {
            socket.close(1007)
          } finally {
            socket.data.queued--
          }
        })
      },
      close(socket) {
        socket.data.disconnect?.()
      }
    }
  })
  return door
}
