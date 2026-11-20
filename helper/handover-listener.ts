/** The page's hand-over: a freshly opened helper listens on loopback and takes one short code from LilBot's own
 *  page. Exact page origins come from the build; another local user is refused by the socket's owner. */
import { samePeerUser } from './loopback-peer'
import { HELPER_VERSION, type HelperSettings, SHORT_CODE } from './settings'

export type HandoverResult = { ok: true } | { ok: false; error: 'refused' | 'busy' }
const plain = { 'Cache-Control': 'no-store' }

export function listenForHandover(settings: HelperSettings, port: number, until: number, accept: (code: string) => Promise<HandoverResult>) {
  const origins = new Set(settings.origins)
  let used = false
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    development: false,
    maxRequestBodySize: 1024,
    error: () => new Response('Internal error', { status: 500, headers: plain }),
    async fetch(request, server) {
      const origin = request.headers.get('origin') ?? ''
      // Host defeats DNS rebinding; Origin keeps every other page out. No CORS headers leave on refusal.
      if (request.headers.get('host') !== `127.0.0.1:${server.port}` || !origins.has(origin) || Date.now() > until)
        return new Response('Forbidden', { status: 403, headers: plain })
      const headers = { ...plain, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
      const path = new URL(request.url).pathname
      if (request.method === 'OPTIONS')
        return new Response(null, {
          status: 204,
          headers: {
            ...headers,
            'Access-Control-Allow-Methods': 'GET, POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Private-Network': 'true',
            'Access-Control-Max-Age': '60'
          }
        })
      if (path === '/v1/hello' && request.method === 'GET') return Response.json({ app: 'lilbot-helper', version: HELPER_VERSION, state: used ? 'used' : 'waiting' }, { headers })
      if (path !== '/v1/handover' || request.method !== 'POST') return new Response('Not found', { status: 404, headers })
      const peer = server.requestIP(request)
      if (peer?.address !== '127.0.0.1' || !(await samePeerUser(peer.port, server.port!))) return new Response('Forbidden', { status: 403, headers })
      if (!request.headers.get('content-type')?.startsWith('application/json')) return new Response('Expected JSON', { status: 415, headers })
      const code = ((await request.json().catch(() => null)) as { code?: unknown } | null)?.code
      if (typeof code !== 'string' || !SHORT_CODE.test(code)) return Response.json({ ok: false, error: 'refused' }, { status: 400, headers })
      if (used) return Response.json({ ok: false, error: 'used' }, { status: 410, headers })
      used = true
      const result = await accept(code)
      return Response.json(result, { status: result.ok ? 200 : 422, headers })
    }
  })
}
