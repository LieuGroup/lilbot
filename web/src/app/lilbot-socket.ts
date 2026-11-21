/** The browser's connection to the LilBot server: typed requests, chat events, automatic reconnect. */
import type { ChatEvent } from '../../../shared/chat-schema'
import { LilBotError, type Method, type Params, type Results } from '../../../shared/protocol'

type Pending = { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
type ChatListener = (event: ChatEvent) => void

const REQUEST_TIMEOUT_MS = 90_000
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10_000]

class LilBotSocket {
  private socket: WebSocket | null = null
  private nextId = 1
  private attempt = 0
  private pending = new Map<number, Pending>()
  private chatListeners = new Map<string, Set<ChatListener>>()
  private connectionListeners = new Set<(connected: boolean) => void>()
  private pushListeners = new Map<string, Set<(frame: any) => void>>()
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
        waiting.reject(new LilBotError('disconnected', 'The connection to LilBot was lost.'))
      }
      this.pending.clear()
      this.setConnected(false)
      setTimeout(() => this.connect(), RECONNECT_DELAYS_MS[Math.min(this.attempt++, RECONNECT_DELAYS_MS.length - 1)])
    }
  }

  call<M extends Method>(method: M, params: Params<M>): Promise<Results[M]> {
    const socket = this.socket
    if (!socket || socket.readyState !== WebSocket.OPEN) return Promise.reject(new LilBotError('disconnected', 'Not connected to LilBot.'))
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

  private onPush(event: string, listener: (frame: any) => void) {
    const listeners = this.pushListeners.get(event) ?? new Set()
    this.pushListeners.set(event, listeners)
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }

  /** Told when bots, preferences or sections changed, here or on another device. */
  onBotsChanged(listener: () => void) {
    return this.onPush('bots.changed', () => listener())
  }

  /** Told when a fact was saved or forgotten, by a bot or in the app. */
  onMemoryChanged(listener: () => void) {
    return this.onPush('memory.changed', () => listener())
  }

  /** Told when a computer was added, removed, or went online or offline. */
  onComputersChanged(listener: () => void) {
    return this.onPush('computers.changed', () => listener())
  }

  /** Told when a device was renamed or tied to a computer, here or in another tab. */
  onDevicesChanged(listener: () => void) {
    return this.onPush('devices.changed', () => listener())
  }

  /** Told when an exchange between bots started, moved or ended. It names no bot, and comes with every tool call in one. */
  onThreadsChanged(listener: () => void) {
    return this.onPush('threads.changed', () => listener())
  }

  /** Told when a routine was made, changed or removed, or one of its runs started or ended. */
  onRoutinesChanged(listener: () => void) {
    return this.onPush('routines.changed', () => listener())
  }

  /** Told when any goal changed (its review routine among them). */
  onGoalsChanged(listener: () => void) {
    return this.onPush('goals.changed', () => listener())
  }

  /** Told when the history import brought in more of a bot's conversation. */
  onHistoryChanged(listener: (botId: string) => void) {
    return this.onPush('history.changed', frame => listener(frame.botId))
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

export const lilbot = new LilBotSocket()

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.')
