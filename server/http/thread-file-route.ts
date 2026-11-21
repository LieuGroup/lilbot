/** Downloads of files passed between bots: `/api/threads/<bot id>/<thread id>/<message id>/<n>`, the n-th file of that message,
 *  as the bot reading the exchange sees it. Same Host, Origin and cross-site rules as attachments and the Library. */
import type { ThreadService } from '../threads/thread-service'
import { downloadHeaders } from './attachment-routes'
import { socketAllowed } from './socket-guard'

export async function threadFileRoute(request: Request, hosts: Set<string>, threads: Pick<ThreadService, 'file'>) {
  if (!socketAllowed(request, hosts) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Forbidden', { status: 403 })
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  const parts = new URL(request.url).pathname.split('/')
  if (parts.length !== 7 || !/^\d{1,2}$/.test(parts[6])) return new Response('Not found', { status: 404 })
  try {
    const [botId, threadId, messageId] = parts.slice(3, 6).map(decodeURIComponent)
    const file = await threads.file(botId, threadId, messageId, Number(parts[6]))
    return new Response(file.data, { headers: downloadHeaders(file.name, 'application/octet-stream') })
  } catch {
    return new Response('File missing or unavailable', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
}
