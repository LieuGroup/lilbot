/** The app's connection to the LilBot server: the shared client over this install's socket,
 *  configured with the server address and the Access token Oscar pastes in once. */
import { type ClientSocket, LilBotSocket } from '../../../shared/client/socket'
import { authHeadersForUrl, httpOrigin, resolveServerAssetUrl, socketUrl } from './asset-url'
import { useConnectionStore } from './store'

export { httpOrigin, socketUrl }

/** Plain HTTP is only for a server on this Mac (the UI tests' fake server); anywhere else the
 *  Access token would travel unencrypted, so it is refused. */
export function serverUrlError(url: string): string | null {
  const trimmed = url.trim()
  if (!trimmed) return 'Give the server address.'
  if (/^http:\/\//.test(trimmed) && !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(trimmed)) return 'Use https:// for a server that is not on this Mac.'
  return null
}

/** Resolves a server-relative path (or same-origin absolute URL) against the configured server address. */
export function serverAssetUrl(path: string): string | null {
  return resolveServerAssetUrl(path, useConnectionStore.getState().settings?.serverUrl)
}

/** Auth headers for HTTP uploads and authenticated attachment image loads — strictly scoped to the configured server origin. */
export function serverAuthHeadersFor(targetUrl: string | null | undefined): Record<string, string> {
  const settings = useConnectionStore.getState().settings
  return authHeadersForUrl(targetUrl, settings?.serverUrl, settings?.accessToken)
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
