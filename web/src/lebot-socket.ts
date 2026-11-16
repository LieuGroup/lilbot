/** The browser's connection to the LeBot server: typed requests, chat events, automatic reconnect. */
import type { ChatEvent } from '../../shared/chat-schema'
import { LeBotError, type Method, type Params, type Results } from '../../shared/protocol'

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
type ChatListener = (event: ChatEvent) => void

const REQUEST_TIMEOUT_MS = 90_000
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000]

class LeBotSocket {
  private socket: WebSocket | null = null
  private nextId = 1
  private attempt = 0
  private pending = new Map<number, Pending>()
  private chatListeners = new Map<string, Set<ChatListener>>()
  private connectionListeners = new Set<(connected: boolean) => void>()
  private botsChangedListeners = new Set<() => void>()
  connected = false

  connect() {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(`${scheme}//${location.host}/ws`)
    this.socket = socket
    socket.onopen = () => {
      this.attempt = 0
      this.setConnected(true)
    }
    socket.onmessage = message => this.handleFrame(String(message.data))
    socket.onclose = () => {
      for (const waiting of this.pending.values()) {
        clearTimeout(waiting.timer)
        waiting.reject(new LeBotError('disconnected', 'The connection to LeBot was lost.'))
      }
      this.pending.clear()
      this.setConnected(false)
      setTimeout(() => this.connect(), RECONNECT_DELAYS_MS[Math.min(this.attempt++, RECONNECT_DELAYS_MS.length - 1)])
    }
  }

  call<M extends Method>(method: M, params: Params<M>): Promise<Results[M]> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new LeBotError('disconnected', 'Not connected to LeBot.'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new LeBotError('timeout', 'LeBot did not answer in time.'))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, reject, timer })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /** Receive one chat's events; several parts of the page may listen to the same chat.
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

  /** Told when bots, preferences or sections changed, here or on another device. */
  onBotsChanged(listener: () => void) {
    this.botsChangedListeners.add(listener)
    return () => void this.botsChangedListeners.delete(listener)
  }

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
      console.warn('LeBot: dropped a frame that was not JSON')
      return
    }
    if (frame.event === 'bots.changed') {
      for (const listener of this.botsChangedListeners) listener()
      return
    }
    if (frame.event === 'chat') {
      for (const listener of this.chatListeners.get(frame.chatId) ?? []) listener(frame.data)
      return
    }
    const waiting = this.pending.get(frame.id)
    if (!waiting) return
    clearTimeout(waiting.timer)
    this.pending.delete(frame.id)
    if (frame.ok) waiting.resolve(frame.result)
    else waiting.reject(new LeBotError(frame.error?.code ?? 'failed', frame.error?.message ?? 'The request failed.'))
  }
}

export const lebot = new LeBotSocket()

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.')
