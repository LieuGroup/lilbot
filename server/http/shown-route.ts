/** `/api/shown/<bot>/<id>`: a file a bot showed in its reply (#317), sent from its saved path with byte ranges so a video
 *  seeks without loading the whole file. Same Host, Origin and download headers as the Library's route. */

import { parseRange, readSlice } from '../shown/shown-range'
import type { ShownService } from '../shown/shown-service'
import { downloadHeaders } from './attachment-routes'
import { socketAllowed } from './socket-guard'

const CHUNK = 256 * 1024

export async function shownRoute(request: Request, hosts: Set<string>, shown: Pick<ShownService, 'content'>) {
  if (!socketAllowed(request, hosts) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Forbidden', { status: 403 })
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 })
  const parts = new URL(request.url).pathname.split('/')
  if (parts.length !== 5) return new Response('Not found', { status: 404 })
  let file: Awaited<ReturnType<ShownService['content']>>
  try {
    file = await shown.content(decodeURIComponent(parts[3]), decodeURIComponent(parts[4]))
  } catch (error) {
    const large = (error as { code?: unknown }).code === 'file_too_large'
    return new Response(large ? 'Too large to show' : 'File missing or unavailable', { status: large ? 413 : 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const headers: Record<string, string> = { ...downloadHeaders(file.name, file.mime), 'Accept-Ranges': 'bytes' }
  const range = parseRange(request.headers.get('range'), file.size)
  if (range === 'unsatisfiable') {
    await file.handle.close()
    return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } })
  }
  const { start, end } = range ?? { start: 0, end: file.size - 1 }
  const length = Math.max(0, end - start + 1)
  headers['Content-Length'] = String(length)
  if (range) headers['Content-Range'] = `bytes ${start}-${end}/${file.size}`
  if (request.method === 'HEAD' || length === 0) {
    await file.handle.close()
    return new Response(null, { status: range ? 206 : 200, headers })
  }
  let sent = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const part = await readSlice(file.handle, start + sent, Math.min(CHUNK, length - sent))
      sent += part.length
      if (part.length) controller.enqueue(part)
      if (!part.length || sent >= length) {
        controller.close()
        await file.handle.close()
      }
    },
    cancel: () => file.handle.close()
  })
  return new Response(body, { status: range ? 206 : 200, headers })
}
