/** The client side of the LilBot protocol, shared by the web app and the iOS app: typed requests,
 *  chat events, automatic reconnect. Each client supplies its socket factory and `/ws` address. */
import type { ChatEvent } from '../chat-schema'
import { LilBotError } from '../lilbot-error'
import type { EventFrame, Method, Params, Results } from '../protocol'

/** The part of a WebSocket the client uses, so both the browser's and React Native's fit. */
export interface ClientSocket {
  readonly readyState: number
  send(data: string): void
  close(): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
}

export type SocketFactory = (url: string) => ClientSocket

const OPEN = 1
const REQUEST_TIMEOUT_MS = 90_000
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000]

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export type ChatListener = (event: ChatEvent) => void

export class LilBotSocket {
  private socket: ClientSocket | null = null
  private nextId = 1
  private attempt = 0
  private pending = new Map<number, Pending>()
  private chatListeners = new Map<string, Set<ChatListener>>()
  private connectionListeners = new Set<(connected: boolean) => void>()
  private pushListeners = new Map<string, Set<(frame: EventFrame) => void>>()
  private disposed = false
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  connected = false

  constructor(private options: { url: string | (() => string); createSocket?: SocketFactory; reconnectDelaysMs?: number[] }) {}

  connect() {
    if (this.disposed) return
    const url = typeof this.options.url === 'string' ? this.options.url : this.options.url()
    const socket = (this.options.createSocket ?? (address => new WebSocket(address) as unknown as ClientSocket))(url)
    this.socket = socket
    socket.onopen = () => {
      this.attempt = 0
      this.setConnected(true)
    }
    socket.onmessage = message => this.handleFrame(String(message.data))
    socket.onclose = () => {
      if (this.disposed) return
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer)
        waiting.reject(new LilBotError('disconnected', 'The connection to LilBot was lost.'))
      }
      this.pending.clear()
      this.setConnected(false)
      const delays = this.options.reconnectDelaysMs ?? RECONNECT_DELAYS_MS
      this.reconnectTimer = setTimeout(() => this.connect(), delays[Math.min(this.attempt++, delays.length - 1)])
    }
  }

  /** Close for good: no reconnect, pending requests fail, listeners hear the disconnect. */
  stop() {
    this.disposed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    for (const waiting of this.pending.values()) {
      clearTimeout(waiting.timer)
      waiting.reject(new LilBotError('disconnected', 'The connection to LilBot was closed.'))
    }
    this.pending.clear()
    this.setConnected(false)
    this.socket?.close()
  }

  call<M extends Method>(method: M, params: Params<M>): Promise<Results[M]> {
    const socket = this.socket
    if (!socket || socket.readyState !== OPEN) return Promise.reject(new LilBotError('disconnected', 'Not connected to LilBot.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new LilBotError('timeout', 'LilBot did not answer in time.'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Receive one chat's events; several parts of the app may listen to the same chat.
   *  Returns the function that stops listening. */
  onChat(chatId: string, listener: ChatListener) {
    const listeners = this.chatListeners.get(chatId) ?? new Set<ChatListener>()
    listeners.add(listener)
    this.chatListeners.set(chatId, listeners)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0 && this.chatListeners.get(chatId) === listeners) this.chatListeners.delete(chatId)
    }
  }

  private onPush(event: string, listener: (frame: any) => void) {
    const listeners = this.pushListeners.get(event) ?? new Set()
    this.pushListeners.set(event, listeners)
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }

  /** Told when bots, preferences or sections changed, here or on another device. */
  onBotsChanged = (listener: () => void) => this.onPush('bots.changed', () => listener())

  /** Told when a fact was saved or forgotten, by a bot or in the app. */
  onMemoryChanged = (listener: () => void) => this.onPush('memory.changed', () => listener())

  /** Told when a computer was added, removed, or went online or offline. */
  onComputersChanged = (listener: () => void) => this.onPush('computers.changed', () => listener())

  /** Told when a device was renamed or tied to a computer, here or in another tab. */
  onDevicesChanged = (listener: () => void) => this.onPush('devices.changed', () => listener())

  /** Told when an exchange between bots started, moved or ended. It names no bot, and comes with every tool call in one. */
  onThreadsChanged = (listener: () => void) => this.onPush('threads.changed', () => listener())

  /** Told when a routine was made, changed or removed, or one of its runs started or ended. */
  onRoutinesChanged = (listener: () => void) => this.onPush('routines.changed', () => listener())

  /** Told when a webhook was made, changed or removed, or one of its runs was queued, started or ended. */
  onWebhooksChanged = (listener: () => void) => this.onPush('webhooks.changed', () => listener())

  /** Told when a skill was written or switched, or an engine's skills were included or excluded. */
  onSkillsChanged = (listener: () => void) => this.onPush('skills.changed', () => listener())

  /** Told when any goal changed (its review routine among them). */
  onGoalsChanged = (listener: () => void) => this.onPush('goals.changed', () => listener())

  /** Told when the history import brought in more of a bot's conversation. */
  onHistoryChanged = (listener: (botId: string) => void) => this.onPush('history.changed', frame => listener(frame.botId))

  /** Told when a bot gave a file to its Library. */
  onLibraryChanged = (listener: (botId: string) => void) => this.onPush('library.changed', frame => listener(frame.botId))

  onConnection(listener: (connected: boolean) => void) {
    this.connectionListeners.add(listener)
    return () => void this.connectionListeners.delete(listener)
  }

  private setConnected(connected: boolean) {
    this.connected = connected
    for (const listener of this.connectionListeners) listener(connected)
  }

  private handleFrame(raw: string) {
    let frame: any
    try {
      frame = JSON.parse(raw)
    } catch {
      console.warn('LilBot: dropped a frame that was not JSON')
      return
    }
    if (frame.event === 'chat') {
      for (const listener of this.chatListeners.get(frame.chatId) ?? []) listener(frame.data)
      return
    }
    if (frame.event) {
      for (const listener of this.pushListeners.get(frame.event) ?? []) listener(frame)
      return
    }
    const waiting = this.pending.get(frame.id)
    if (!waiting) return
    clearTimeout(waiting.timer)
    this.pending.delete(frame.id)
    if (frame.ok) waiting.resolve(frame.result)
    else waiting.reject(new LilBotError(frame.error?.code ?? 'failed', frame.error?.message ?? 'The request failed.'))
  }
}

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.')
