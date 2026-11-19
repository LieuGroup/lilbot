/** Browser routes shared by the private app and the authenticated Access listener. */

import { join, normalize } from 'node:path'
import type { Server } from 'bun'
import type { LibraryService } from '../library/library-service'
import type { BrowserSession } from './browser-session'
import { socketAllowed } from './socket-guard'

export interface SocketData {
  session?: BrowserSession
}

export function appRoutes(library: Pick<LibraryService, 'content'>, dist: string, hosts: Set<string>, engineName: string) {
  return async (request: Request, server: Server<SocketData>): Promise<Response | undefined> => {
    const url = new URL(request.url)
    if (url.pathname === '/ws') {
      if (!socketAllowed(request, hosts)) return new Response('Forbidden', { status: 403 })
      if (server.upgrade(request, { data: {} })) return undefined
      return new Response('Expected a WebSocket upgrade', { status: 400 })
    }
    if (url.pathname.startsWith('/api/library/')) {
      if (!socketAllowed(request, hosts) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Forbidden', { status: 403 })
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
      const parts = url.pathname.split('/')
      if (parts.length !== 5) return new Response('Not found', { status: 404 })
      try {
        const file = await library.content(decodeURIComponent(parts[3]), decodeURIComponent(parts[4]))
        return new Response(file.data, {
          headers: {
            'Content-Type': file.mime,
            'Content-Disposition': 'attachment',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "sandbox; default-src 'none'",
            'Cache-Control': 'no-store'
          }
        })
      } catch {
        return new Response('File missing or unavailable', { status: 404 })
      }
    }
    if (url.pathname === '/api/health') return Response.json({ ok: true, engine: engineName })
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
    const file = Bun.file(join(dist, relative))
    if (relative !== '/' && (await file.exists())) return new Response(file)
    const index = Bun.file(join(dist, 'index.html'))
    if (await index.exists()) return new Response(index)
    return new Response('LilBot web app is not built. Run: bun run build', { status: 503 })
  }
}
