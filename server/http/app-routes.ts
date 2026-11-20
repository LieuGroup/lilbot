/** Browser routes shared by the private app and the authenticated Access listener. */

import type { Server } from 'bun'
import type { AttachmentService } from '../attachments/attachment-service'
import { DOWNLOAD_PATH, type HelperDownloads } from '../computers/helper-downloads'
import type { LibraryService } from '../library/library-service'
import type { ThreadService } from '../threads/thread-service'
import { attachmentRoute } from './attachment-routes'
import type { BrowserSession } from './browser-session'
import { socketAllowed } from './socket-guard'
import { staticFile } from './static-files'
import { threadFileRoute } from './thread-file-route'

export interface SocketData {
  session?: BrowserSession
}

export function appRoutes(
  library: Pick<LibraryService, 'content'>,
  dist: string,
  hosts: Set<string>,
  engineName: string,
  attachments?: AttachmentService,
  downloads?: HelperDownloads,
  threads?: Pick<ThreadService, 'file'>
) {
  return async (request: Request, server: Server<SocketData>): Promise<Response | undefined> => {
    const url = new URL(request.url)
    if (url.pathname.startsWith(DOWNLOAD_PATH))
      return downloads ? helperDownload(request, hosts, downloads, url.pathname.slice(DOWNLOAD_PATH.length)) : new Response('Not found', { status: 404 })
    if (url.pathname.startsWith('/api/attachments/')) return attachments ? attachmentRoute(request, hosts, attachments) : new Response('Not found', { status: 404 })
    if (url.pathname.startsWith('/api/threads/')) return threads ? threadFileRoute(request, hosts, threads) : new Response('Not found', { status: 404 })
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
    return staticFile(request, dist, url.pathname)
  }
}

/** The installer carries no secret, but it is LilBot's own: same Host and Origin rules as the socket. */
function helperDownload(request: Request, hosts: Set<string>, downloads: HelperDownloads, name: string) {
  if (!socketAllowed(request, hosts) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Forbidden', { status: 403 })
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const file = downloads.file(name)
  if (!file) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  return new Response(file, {
    headers: {
      'Content-Type': name.endsWith('.zip') ? 'application/zip' : 'application/gzip',
      'Content-Disposition': `attachment; filename="${name}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'no-store'
    }
  })
}
