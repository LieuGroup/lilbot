/** Dedicated loopback listener; no static files, engine endpoints, proxy, or browser socket. Routes: the helper's
 *  register (8 KiB bodies) and connect, and webhook deliveries (`webhook-route.ts`). */

import { verifyHelperFrame } from '../../helper/frame-auth'
import { HelperFrame } from '../../shared/computer-schema'
import type { WorkerLeaderFrame } from '../../shared/worker-frame-schema'
import { Registration } from '../computers/computer-auth'
import type { ComputerService } from '../computers/computer-service'
import { createWorkerSocketState, handleWorkerFrame, isWorkerFrame, type WorkerDoorBridge, type WorkerSocketState } from '../computers/worker-door'
import { HOOK_PATH } from '../webhooks/webhook-address'
import { WEBHOOK_LIMITS } from '../webhooks/webhook-limits'
import { addressGroup, byteBudget, connectionBudget, plainServerError, readLimited } from './listener-safety'
import type { HookAnswer } from './webhook-route'

const HELPER_BODY_BYTES = 8192

export function startPublicDoor(
  computers: ComputerService,
  port: number,
  options: { onClose?: (code: number) => void; hooks?: (request: Request, token: string, address: string) => Promise<HookAnswer>; workers?: WorkerDoorBridge } = {}
) {
  const { onClose = () => {}, hooks, workers } = options
  const allowed = connectionBudget()
  const perComputer = connectionBudget(6)
  const signed = connectionBudget(6, true)
  const door = Bun.serve<{
    id: string
    nonce: string
    disconnect?: () => void
    workerDisconnect?: () => void
    workerSend?: (frame: WorkerLeaderFrame) => boolean
    workerState?: WorkerSocketState
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
    maxRequestBodySize: WEBHOOK_LIMITS.bodyBytes,
    async fetch(request, server) {
      try {
        const url = new URL(request.url)
        const headers = { 'Cache-Control': 'no-store' }
        if (url.search || request.headers.has('origin')) return new Response('Forbidden', { status: 403, headers })
        const address = request.headers.get('cf-connecting-ip') ?? server.requestIP(request)?.address ?? 'unknown'
        const hook = hooks && HOOK_PATH.exec(url.pathname)
        if (hook) {
          const [status, text] = (await hooks(request, hook[1], address)) ?? [404, 'Not found']
          return new Response(text, { status, headers })
        }
        const connecting = url.pathname === '/helper/connect' && request.method === 'GET'
        const claimed = request.headers.get('x-lilbot-computer') ?? ''
        // Unknown identities cannot allocate budgets. Valid signatures never spend an
        // unauthenticated caller's budget, even from the same address or a full table.
        if (connecting && !computers.auth.publicKey(claimed)) return new Response('Authentication refused', { status: 403, headers })
        const id = connecting ? computers.auth.authenticate(request) : null
        if (id && !signed(id)) return new Response('Too many requests', { status: 429, headers })
        if (!id && (!allowed(address) || (connecting && !perComputer(`${claimed}:${addressGroup(address)}`)))) return new Response('Too many requests', { status: 429, headers })
        if (url.pathname === '/helper/register' && request.method === 'POST') {
          const body = await readLimited(request, HELPER_BODY_BYTES)
          if (!body) return new Response('Payload too large', { status: 413, headers })
          try {
            const input = Registration.parse(JSON.parse(new TextDecoder().decode(body)))
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
        const key = computers.auth.publicKey(socket.data.id)
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
        socket.data.workerState = createWorkerSocketState()
        socket.data.workerSend = frame => send(JSON.stringify(frame))
        if (socket.readyState === 1 && workers?.onConnect) socket.data.workerDisconnect = workers.onConnect(socket.data.id, socket.data.workerSend)
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
        const arrivedAt = Date.now()
        void computers.payload(socket.data.id, () => {
          if (socket.readyState !== 1 || !computers.isPeer(socket.data.id, socket.data.disconnect) || computers.store.revoked(socket.data.id)) return
          try {
            const envelope = JSON.parse(String(message))
            if (!verifyHelperFrame(computers.auth.publicKey(socket.data.id)!, socket.data.id, socket.data.nonce, socket.data.sequence, envelope)) return socket.close(1007)
            socket.data.sequence++
            const frame = HelperFrame.parse(JSON.parse(envelope.payload))
            if (frame.type === 'heartbeat') {
              if (!frame.challenge && arrivedAt - socket.data.heartbeatAt < 5000) return
              if (!frame.challenge) socket.data.heartbeatAt = arrivedAt
              computers.heartbeat(socket.data.id, socket.data.disconnect, frame.challenge)
            } else if (isWorkerFrame(frame)) {
              if (!handleWorkerFrame(computers.store.db, socket.data.id, frame, socket.data.workerState!, arrivedAt, socket.data.workerSend!, workers)) socket.close(1008)
            } else {
              if (!frame.final) {
                if (frame.result.output.length > 8192 || arrivedAt - (socket.data.progress!.get(frame.id) ?? 0) < 900) return
                if (socket.data.progress!.size >= 8 && !socket.data.progress!.has(frame.id)) return socket.close(1008)
                socket.data.progress!.set(frame.id, arrivedAt)
              } else socket.data.progress!.delete(frame.id)
              if (frame.final && !computers.store.admitFinal(socket.data.id, frame.id, Buffer.byteLength(envelope.payload))) {
                computers.result(socket.data.id, frame.id, { output: '', error: 'Result omitted: receive allowance exhausted.' }, true)
                return
              }
              void computers.payload(socket.data.id, () => {
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
      close(socket, code) {
        onClose(code)
        socket.data.workerDisconnect?.()
        socket.data.disconnect?.()
      }
    }
  })
  return door
}
