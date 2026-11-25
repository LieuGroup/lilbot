/** Loopback HTTP/2 mock server helper for APNs sender tests (no external network calls). */
import http2, { type Http2Server, type IncomingHttpHeaders } from 'node:http2'
import type { AddressInfo } from 'node:net'

interface MockApnsHit {
  path: string
  topic: string
  auth: string
  body: Record<string, unknown>
}

type MockApnsResponder = (
  hit: MockApnsHit,
  stream: http2.ServerHttp2Stream
) => {
  status: number
  body?: string
  headers?: Record<string, string>
  hang?: boolean
  goaway?: boolean
}

export async function startMockApns(respond: MockApnsResponder) {
  const hits: MockApnsHit[] = []
  let sessions = 0
  const server: Http2Server = http2.createServer()
  server.on('session', () => {
    sessions++
  })
  server.on('stream', (rawStream, headers: IncomingHttpHeaders) => {
    const stream = rawStream as http2.ServerHttp2Stream
    let raw = ''
    stream.setEncoding('utf8')
    stream.on('data', chunk => {
      raw += chunk
    })
    stream.on('end', () => {
      const hit: MockApnsHit = {
        path: String(headers[':path'] ?? ''),
        topic: String(headers['apns-topic'] ?? ''),
        auth: String(headers.authorization ?? ''),
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
      }
      hits.push(hit)
      const out = respond(hit, stream)
      if (out.hang) return
      if (out.goaway) {
        stream.respond({ ':status': out.status, ...out.headers })
        stream.end(out.body ?? '')
        stream.session?.goaway()
        return
      }
      stream.respond({ ':status': out.status, 'content-type': 'application/json', ...out.headers })
      stream.end(out.body ?? '')
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    origin: `http://127.0.0.1:${port}`,
    hits,
    sessionCount: () => sessions,
    close: () => new Promise<void>(resolve => server.close(() => resolve()))
  }
}
