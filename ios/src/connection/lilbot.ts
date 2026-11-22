/** The app's connection to the LilBot server: the shared client over this install's socket,
 *  configured with the server address and the Access token Oscar pastes in once. */
import { LilBotSocket, type ClientSocket } from '../../../shared/client/socket'
import { useConnectionStore } from './store'

/** Plain HTTP is only for a server on this Mac (the UI tests' fake server); anywhere else the
 *  Access token would travel unencrypted, so it is refused. */
export function serverUrlError(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return 'Give the server address.'
  if (/^http:\/\//.test(trimmed) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(trimmed)) return 'Use https:// for a server that is not on this Mac.'
  return null
}

/** "https://lilbot.example.com" or a bare host becomes the `/ws` address of that server. */
export function socketUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  const http = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
  return `${http.replace(/^http/, 'ws')}/ws`
}

let socket: LilBotSocket | null = null
let socketKey = ''

/** The live socket, created on first use from the saved settings. Null until a server is set. */
export function ensureSocket(): LilBotSocket | null {
  const { settings } = useConnectionStore.getState()
  if (!settings?.serverUrl) return null
  const token = settings.accessToken.trim()
  const key = `${settings.serverUrl}\n${token}`
  if (socket && socketKey !== key) {
    socket.stop()
    socket = null
    socketKey = ''
  }
  if (!socket) {
    socket = new LilBotSocket({
      url: () => socketUrl(settings.serverUrl),
      // React Native's WebSocket takes headers as a third argument; its types only declare two.
      createSocket: url => {
        const RNWebSocket = WebSocket as unknown as new (address: string, protocols: null, options: { headers: Record<string, string> }) => ClientSocket
        return new RNWebSocket(url, null, { headers: token ? { 'cf-access-jwt-assertion': token } : {} })
      }
    })
    socketKey = key
  }
  return socket
}

export { socket as lilbotSocket }
