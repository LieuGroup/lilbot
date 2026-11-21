/** One JSON-RPC connection to the Hermes gateway for one profile. */
import { LilBotError } from '../../../shared/lilbot-error'
import { attachToHermes } from './hermes-attach'

export interface HermesEvent {
  type: string
  payload: Record<string, any>
  sessionId?: string
  executionGeneration?: number
}

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const REQUEST_TIMEOUT_MS = 60_000
const READY_TIMEOUT_MS = 20_000

export class HermesSocket {
  private nextId = 1
  private pending = new Map<number, Pending>()
  private open = true

  private constructor(
    private socket: WebSocket,
    private onEvent: (event: HermesEvent) => void,
    private onClose: () => void
  ) {}

  /** `profile` empty = Hermes' default profile. Resolves once Hermes says the socket is ready. */
  static async connect(profile: string, onEvent: (event: HermesEvent) => void = () => {}, onClose: () => void = () => {}): Promise<HermesSocket> {
    const grant = await attachToHermes(profile)
    const socket = new WebSocket(grant.url, grant.protocols)

    return new Promise<HermesSocket>((resolve, reject) => {
      const connection = new HermesSocket(socket, onEvent, onClose)
      const timer = setTimeout(() => {
        socket.close()
        reject(new LilBotError('engine_unavailable', 'Hermes did not answer in time.'))
      }, READY_TIMEOUT_MS)

      socket.onmessage = message => {
        for (const line of String(message.data).split('\n')) {
          if (!line.trim()) continue
          const event = connection.handleFrame(line)
          if (event?.type === 'gateway.ready') {
            clearTimeout(timer)
            resolve(connection)
          }
        }
      }
      socket.onclose = () => {
        clearTimeout(timer)
        connection.closed()
        reject(new LilBotError('engine_unavailable', 'Hermes closed the connection.'))
      }
    })
  }

  get isOpen() {
    return this.open
  }

  /** Hands a connection made in advance (see `SpareSockets`) to the code that now uses it. */
  rebind(onEvent: (event: HermesEvent) => void, onClose: () => void): this {
    this.onEvent = onEvent
    this.onClose = onClose
    return this
  }

  request<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (!this.open) return Promise.reject(new LilBotError('engine_unavailable', 'The connection to Hermes is closed.'))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new LilBotError('engine_timeout', `Hermes did not answer ${method} in time.`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  close() {
    this.socket.close()
  }

  private handleFrame(line: string): HermesEvent | null {
    let frame: any
    try {
      frame = JSON.parse(line)
    } catch {
      console.error('[hermes] dropped a frame that was not JSON')
      return null
    }

    const waiting = typeof frame.id === 'number' ? this.pending.get(frame.id) : undefined
    if (waiting) {
      clearTimeout(waiting.timer)
      this.pending.delete(frame.id)
      if (frame.error) {
        // Only short machine codes become part of our error code; free text never does.
        const raw = frame.error.data?.reason ?? frame.error.message
        const reason = typeof raw === 'string' && /^[a-z0-9_]{1,80}$/.test(raw) ? raw : 'request_failed'
        waiting.reject(new LilBotError(`hermes_${reason}`, `Hermes refused the request (${reason.replaceAll('_', ' ')}).`))
      } else {
        waiting.resolve(frame.result)
      }
      return null
    }

    if (frame.method !== 'event' || !frame.params?.type) return null
    const generation = frame.params.execution_generation
    const event: HermesEvent = {
      type: frame.params.type,
      payload: frame.params.payload ?? {},
      sessionId: frame.params.session_id,
      executionGeneration: typeof generation === 'number' ? generation : undefined
    }
    this.onEvent(event)
    return event
  }

  private closed() {
    if (!this.open) return
    this.open = false
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer)
      waiting.reject(new LilBotError('engine_unavailable', 'The connection to Hermes was lost.'))
    }
    this.pending.clear()
    this.onClose()
  }
}

/** Share one management socket, but never let an old close discard a newer attempt. */
export function managementConnection() {
  let current: Promise<HermesSocket> | null = null
  const listeners = new Set<() => void>()
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    socket(): Promise<HermesSocket> {
      if (current) return current
      const attempt = HermesSocket.connect(
        '',
        event => {
          if (event.type === 'sessions.changed' || event.type === 'skills.changed') for (const listener of listeners) listener()
        },
        () => {
          if (current === attempt) current = null
        }
      )
      current = attempt
      attempt.catch(() => {
        if (current === attempt) current = null
      })
      return attempt
    }
  }
}
