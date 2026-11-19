import { LilBotError } from '../../shared/protocol'
import type { AttachmentService } from '../attachments/attachment-service'
import { socketAllowed } from './socket-guard'

export async function attachmentRoute(request: Request, hosts: Set<string>, service: AttachmentService) {
  if (!socketAllowed(request, hosts) || request.headers.get('sec-fetch-site') === 'cross-site') return new Response('Forbidden', { status: 403 })
  const parts = new URL(request.url).pathname.split('/')
  if (parts.length !== 5) return new Response('Not found', { status: 404 })
  try {
    const botId = decodeURIComponent(parts[3]),
      id = decodeURIComponent(parts[4])
    if (request.method === 'PUT') return Response.json(await service.upload(botId, id, request), { headers: { 'Cache-Control': 'no-store' } })
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
    const file = await service.content(botId, id)
    return new Response(file.data, {
      headers: {
        'Content-Type': file.mime,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/'/g, '%27')}`,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
        'Cache-Control': 'no-store'
      }
    })
  } catch (error) {
    return Response.json(
      { error: error instanceof LilBotError ? { code: error.code, message: error.message } : { code: 'unavailable', message: 'File missing or unavailable.' } },
      { status: 400 }
    )
  }
}
