/** Lightweight JSON-RPC 2.0 WebSocket client for Hermes's canonical gateway in the helper.
 *  Supports RPC calls, canonical event notifications, and server->client JSON-RPC request responses. */
import type { HermesGrant } from './worker-hermes-env'

export interface HermesGatewayEvent {
  type: string
  payload: Record<string, any>
  sessionId?: string
  executionGeneration?: number
}

export interface HermesServerRequest {
  id: string
  method: string
  params: Record<string, any>
}

export class HermesRpcError extends Error {
  constructor(
    readonly reason: string,
    message: string,
    readonly revision?: number,
    readonly executionGeneration?: number
  ) {
    super(message)
    this.name = 'HermesRpcError'
  }
}

export interface HermesSocketHandlers {
  onEvent?: (event: HermesGatewayEvent) => void
  onServerRequest?: (req: HermesServerRequest) => void
  onClose?: () => void
  readyTimeoutMs?: number
  requestTimeoutMs?: number
  createWebSocket?: (url: string, protocols: string[]) => WebSocket
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const DEFAULT_READY_TIMEOUT_MS = 20_000
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

export class HermesWorkerSocket {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private open = true
  private onEvent: (event: HermesGatewayEvent) => void
  private onServerRequest: (req: HermesServerRequest) => void
  private onClose: () => void
  private requestTimeoutMs: number

  private constructor(
    private socket: WebSocket,
    handlers: HermesSocketHandlers
  ) {
    this.onEvent = handlers.onEvent ?? (() => {})
    this.onServerRequest = handlers.onServerRequest ?? (() => {})
    this.onClose = handlers.onClose ?? (() => {})
    this.requestTimeoutMs = handlers.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  }

  static connect(grant: HermesGrant, handlers: HermesSocketHandlers = {}): Promise<HermesWorkerSocket> {
    const socket = handlers.createWebSocket ? handlers.createWebSocket(grant.url, grant.protocols) : new WebSocket(grant.url, grant.protocols)
    const readyMs = handlers.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS

    return new Promise<HermesWorkerSocket>((resolve, reject) => {
      const client = new HermesWorkerSocket(socket, handlers)
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try {
          socket.close()
        } catch {}
        reject(new Error('Hermes gateway did not become ready in time.'))
      }, readyMs)

      socket.onmessage = message => {
        for (const line of String(message.data).split('\n')) {
          if (!line.trim()) continue
          const event = client.handleFrame(line)
          if (!settled && event?.type === 'gateway.ready') {
            settled = true
            clearTimeout(timer)
            resolve(client)
          }
        }
      }
      socket.onerror = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        client.handleClose()
        reject(new Error('Could not connect to Hermes gateway.'))
      }
      socket.onclose = () => {
        clearTimeout(timer)
        client.handleClose()
        if (!settled) {
          settled = true
          reject(new Error('Hermes gateway closed before becoming ready.'))
        }
      }
    })
  }

  get isOpen() {
    return this.open
  }

  request<T = any>(method: string, params: Record<string, unknown> = {}, timeoutMs = this.requestTimeoutMs): Promise<T> {
    if (!this.open) return Promise.reject(new HermesRpcError('connection_closed', 'Connection to Hermes gateway is closed.'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new HermesRpcError('timeout', `Hermes did not answer ${method} in time.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(new HermesRpcError('connection_closed', 'Failed to send request to Hermes gateway.'))
      }
    })
  }

  respond(id: string, result: Record<string, unknown>) {
    if (!this.open) return
    try {
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, result }))
    } catch {}
  }

  close() {
    if (!this.open) return
    try {
      this.socket.close()
    } catch {}
    this.handleClose()
  }

  private handleFrame(line: string): HermesGatewayEvent | null {
    let frame: any
    try {
      frame = JSON.parse(line)
    } catch {
      return null
    }
    if (!frame || typeof frame !== 'object') return null

    if (typeof frame.id === 'number' && this.pending.has(frame.id)) {
      const waiting = this.pending.get(frame.id)!
      clearTimeout(waiting.timer)
      this.pending.delete(frame.id)
      if (frame.error) {
        const raw = frame.error.data?.reason ?? frame.error.message
        const reason = typeof raw === 'string' && /^[a-z0-9_]{1,80}$/.test(raw) ? raw : 'request_failed'
        const detail = typeof frame.error.data?.detail === 'string' ? frame.error.data.detail : typeof frame.error.message === 'string' ? frame.error.message : reason
        const rev = typeof frame.error.data?.revision === 'number' ? frame.error.data.revision : undefined
        const gen = typeof frame.error.data?.execution_generation === 'number' ? frame.error.data.execution_generation : undefined
        waiting.reject(new HermesRpcError(reason, detail, rev, gen))
      } else waiting.resolve(frame.result)
      return null
    }

    if (typeof frame.id === 'string' && typeof frame.method === 'string') {
      this.onServerRequest({ id: frame.id, method: frame.method, params: frame.params && typeof frame.params === 'object' ? frame.params : {} })
      return null
    }

    if (frame.method !== 'event' || typeof frame.params?.type !== 'string') return null
    const gen = frame.params.execution_generation
    const event: HermesGatewayEvent = {
      type: frame.params.type,
      payload: frame.params.payload && typeof frame.params.payload === 'object' ? frame.params.payload : {},
      sessionId: typeof frame.params.session_id === 'string' ? frame.params.session_id : undefined,
      executionGeneration: typeof gen === 'number' ? gen : undefined
    }
    this.onEvent(event)
    return event
  }

  private handleClose() {
    if (!this.open) return
    this.open = false
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer)
      waiting.reject(new HermesRpcError('connection_closed', 'The connection to Hermes gateway closed.'))
    }
    this.pending.clear()
    this.onClose()
  }
}
