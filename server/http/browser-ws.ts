/** Browser WebSocket lifecycle and server-side ping/pong keepalive shared by the private and Access listeners. */
import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { SocketData } from './app-routes'
import type { BrowserSession } from './browser-session'

const DEFAULT_PING_INTERVAL_MS = 30_000

export interface BrowserWebSocketOptions {
  topic: string
  createSession: (socket: ServerWebSocket<SocketData>) => BrowserSession
  pingIntervalMs?: number
}

/** Tracks open browser sockets, sends periodic WebSocket pings so idle visible apps refresh presence on pong,
 *  and lets dead or frozen sockets stop answering and expire automatically. */
export function createBrowserWebSocket(options: BrowserWebSocketOptions): {
  websocket: WebSocketHandler<SocketData>
  stop: () => void
} {
  const openSockets = new Set<ServerWebSocket<SocketData>>()
  const pingIntervalMs = options.pingIntervalMs ?? DEFAULT_PING_INTERVAL_MS
  const ping = () => {
    for (const socket of openSockets) {
      if (socket.readyState !== WebSocket.OPEN) {
        openSockets.delete(socket)
        continue
      }
      try {
        socket.ping()
      } catch {}
    }
  }
  const timer = pingIntervalMs > 0 ? setInterval(ping, pingIntervalMs) : undefined
  timer?.unref?.()

  const websocket: WebSocketHandler<SocketData> = {
    open(socket) {
      openSockets.add(socket)
      socket.subscribe(options.topic)
      socket.data.session = options.createSession(socket)
    },
    message(socket, message) {
      void socket.data.session?.handle(typeof message === 'string' ? message : message.toString())
    },
    pong(socket) {
      socket.data.session?.touch()
    },
    close(socket) {
      openSockets.delete(socket)
      socket.data.session?.close()
    }
  }

  return {
    websocket,
    stop: () => {
      if (timer) clearInterval(timer)
      openSockets.clear()
    }
  }
}
