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

/** "https://lilbot.example.com" or a bare host becomes the normalized HTTP origin for uploads and images. */
export function httpOrigin(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '')
  return /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
}

/** "https://lilbot.example.com" or a bare host becomes the `/ws` address of that server. */
export function socketUrl(base: string): string {
  return `${httpOrigin(base).replace(/^http/, 'ws')}/ws`
}

/** Resolves a server-relative path (like `/api/attachments/...`) against the configured server address. */
export function serverAssetUrl(path: string): string | null {
  const settings = useConnectionStore.getState().settings
  if (!settings?.serverUrl) return null
  if (/^https?:\/\//.test(path)) return path
  const normalized = path.startsWith('/') ? path : `/${path}`
  return `${httpOrigin(settings.serverUrl)}${normalized}`
}

/** Auth headers for HTTP uploads and authenticated attachment image loads against the configured server. */
export function serverAuthHeaders(): Record<string, string> {
  const token = useConnectionStore.getState().settings?.accessToken.trim() ?? ''
  return token ? { 'cf-access-jwt-assertion': token } : {}
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
