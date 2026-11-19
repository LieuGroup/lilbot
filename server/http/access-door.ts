import type { WebSocketHandler } from 'bun'
import type { AccessSettings } from './access-settings'
import { accessToken, accessVerifier } from './access-token'
import type { appRoutes, SocketData } from './app-routes'
import { plainServerError } from './listener-safety'
import { socketAllowed } from './socket-guard'

/** No engine or helper handler is passed to this listener. */
export function startAccessDoor(settings: AccessSettings, routes: ReturnType<typeof appRoutes>, websocket: WebSocketHandler<SocketData>) {
  const verify = accessVerifier(settings)
  const hosts = new Set([settings.host])
  return Bun.serve<SocketData>({
    hostname: '127.0.0.1',
    port: settings.port,
    development: false,
    error: plainServerError,
    async fetch(request, server) {
      try {
        const path = new URL(request.url).pathname
        if (
          path === '/engine' ||
          path.startsWith('/engine/') ||
          path === '/helper' ||
          path.startsWith('/helper/') ||
          !socketAllowed(request, hosts) ||
          !(await verify(accessToken(request)))
        ) {
          return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'text/plain' } })
        }
        return await routes(request, server)
      } catch {
        return plainServerError()
      }
    },
    websocket
  })
}
