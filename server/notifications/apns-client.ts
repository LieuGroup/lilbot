/** Persistent outbound HTTP/2 session pool for Apple APNs channels with GOAWAY, idle-timeout, and error recovery. */
import http2, { type ClientHttp2Session, type OutgoingHttpHeaders, type SecureClientSessionOptions } from 'node:http2'

export type ApnsChannel = 'apns' | 'apns_sandbox'
export type ApnsHttp2Reply = { status: number; body: string; retryAfter: string | string[] | number | undefined }

const DEFAULT_TIMEOUT_MS = 10_000
const IDLE_SESSION_MS = 5 * 60_000

export function validateApnsOrigin(origin: string): string {
  const url = new URL(origin)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error(`Invalid APNs endpoint origin: ${url.protocol}//${url.host}`)
  }
  return url.origin
}

export class ApnsHttp2Pool {
  private sessions = new Map<ApnsChannel, ClientHttp2Session>()

  constructor(
    private readonly endpoints: Record<ApnsChannel, string>,
    private readonly requestTimeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly connectOptions?: SecureClientSessionOptions
  ) {}

  private sessionFor(channel: ApnsChannel): ClientHttp2Session {
    const existing = this.sessions.get(channel)
    if (existing && !existing.closed && !existing.destroyed) return existing
    const session = http2.connect(this.endpoints[channel], this.connectOptions)
    const drop = () => this.sessions.get(channel) === session && this.sessions.delete(channel)
    session.on('error', () => {
      drop()
      session.destroy()
    })
    session.on('goaway', () => {
      drop()
      session.close()
    })
    session.on('close', drop)
    session.setTimeout(IDLE_SESSION_MS, () => {
      drop()
      session.close()
    })
    session.unref?.()
    this.sessions.set(channel, session)
    return session
  }

  drop(channel: ApnsChannel) {
    const session = this.sessions.get(channel)
    if (!session) return
    this.sessions.delete(channel)
    try {
      session.destroy()
    } catch {}
  }

  post(channel: ApnsChannel, headers: OutgoingHttpHeaders, body: Buffer): Promise<ApnsHttp2Reply> {
    return new Promise((resolve, reject) => {
      let settled = false
      const done = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn()
      }
      let req: ReturnType<ClientHttp2Session['request']>
      try {
        req = this.sessionFor(channel).request(headers)
      } catch (err) {
        return reject(err)
      }
      const timer = setTimeout(() => {
        done(() => {
          try {
            req.close(http2.constants.NGHTTP2_CANCEL)
          } catch {}
          reject(new Error('apns_timeout'))
        })
      }, this.requestTimeoutMs)
      timer.unref?.()
      let [status, text] = [0, '']
      let retryAfter: string | string[] | number | undefined
      req.on('response', h => {
        status = Number(h[':status'] ?? 0)
        retryAfter = h['retry-after']
      })
      req.setEncoding('utf8')
      req.on('data', chunk => {
        if (text.length < 4096) text += chunk
      })
      req.on('end', () => done(() => resolve({ status, body: text, retryAfter })))
      req.on('error', err => done(() => reject(err)))
      req.on('close', () => done(() => reject(new Error('apns_stream_closed'))))
      req.end(body)
    })
  }

  close() {
    for (const session of this.sessions.values()) {
      try {
        session.destroy()
      } catch {}
    }
    this.sessions.clear()
  }
}
