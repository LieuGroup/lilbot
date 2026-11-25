/** Direct outbound HTTP/2 Apple APNs sender with persistent connections, per-endpoint sandbox routing, backoff, and rejection breakers. */
import http2, { type ClientHttp2Session, type OutgoingHttpHeaders, type SecureClientSessionOptions } from 'node:http2'
import type { NotificationChannel } from '../../shared/notification-schema'
import { buildApnsRequest, classifyApnsResponse } from './apns-payload'
import { type ApnsCredentials, ApnsTokenProvider } from './apns-token'
import type { NotificationPayload, NotificationRecipient, NotificationSender, NotificationSendResult } from './notification-sender'

type ApnsChannel = 'apns' | 'apns_sandbox'
type Http2Reply = { status: number; body: string; retryAfter: string | string[] | number | undefined }

const DEFAULT_ENDPOINTS: Record<ApnsChannel, string> = { apns: 'https://api.push.apple.com', apns_sandbox: 'https://api.sandbox.push.apple.com' }
const [DEFAULT_TIMEOUT_MS, DEFAULT_REJECT_MS, DEFAULT_THROTTLE_BASE_MS, DEFAULT_THROTTLE_MAX_MS, IDLE_SESSION_MS] = [10_000, 15 * 60_000, 5_000, 5 * 60_000, 5 * 60_000]

export interface ApnsSenderOptions extends ApnsCredentials {
  defaultBundleId?: string
  /** Endpoint origins per channel; defaults to Apple production and sandbox. Non-HTTPS is allowed only for loopback tests. */
  endpoints?: Partial<Record<ApnsChannel, string>>
  connectOptions?: SecureClientSessionOptions
  tokenTtlMs?: number
  requestTimeoutMs?: number
  rejectCooldownMs?: number
  throttleBaseMs?: number
  throttleMaxMs?: number
  now?: () => number
  log?: (message: string) => void
}

function validateOrigin(origin: string): string {
  const url = new URL(origin)
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '::1' || url.hostname === '[::1]' || url.hostname === 'localhost'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error(`Invalid APNs endpoint origin: ${url.protocol}//${url.host}`)
  return url.origin
}

export class ApnsSender implements NotificationSender {
  readonly channels: readonly NotificationChannel[] = ['apns', 'apns_sandbox']
  private readonly tokens: ApnsTokenProvider
  private readonly endpoints: Record<ApnsChannel, string>
  private readonly defaultBundleId?: string
  private readonly now: () => number
  private readonly log: (message: string) => void
  private sessions = new Map<ApnsChannel, ClientHttp2Session>()
  private keyRejected = new Map<ApnsChannel, { until: number; reason: string }>()
  private topicRejected = new Map<string, { until: number; reason: string }>()
  private throttled = new Map<ApnsChannel, { until: number; attempts: number }>()
  private closed = false

  constructor(private readonly opts: ApnsSenderOptions) {
    this.tokens = new ApnsTokenProvider(opts, opts.tokenTtlMs)
    this.endpoints = {
      apns: validateOrigin(opts.endpoints?.apns ?? DEFAULT_ENDPOINTS.apns),
      apns_sandbox: validateOrigin(opts.endpoints?.apns_sandbox ?? DEFAULT_ENDPOINTS.apns_sandbox)
    }
    this.defaultBundleId = opts.defaultBundleId?.trim() || undefined
    this.now = opts.now ?? Date.now
    this.log = opts.log ?? (msg => console.error(msg))
  }

  async send(recipient: NotificationRecipient, payload: NotificationPayload): Promise<NotificationSendResult> {
    if (this.closed) return { status: 'failed', reason: 'apns_closed' }
    if (recipient.channel !== 'apns' && recipient.channel !== 'apns_sandbox') return { status: 'failed', reason: 'unsupported_channel' }
    const channel: ApnsChannel = recipient.channel
    const nowMs = this.now()
    const keyPause = this.keyRejected.get(channel)
    if (keyPause && nowMs < keyPause.until) return { status: 'failed', reason: keyPause.reason }
    const topic = recipient.bundleId.trim() || this.defaultBundleId || ''
    const topicKey = `${channel}\n${topic}`
    const topicPause = topic ? this.topicRejected.get(topicKey) : undefined
    if (topicPause && nowMs < topicPause.until) return { status: 'failed', reason: topicPause.reason }
    const throttle = this.throttled.get(channel)
    if (throttle && nowMs < throttle.until) return { status: 'failed', reason: 'apns_throttled' }
    return this.attempt(channel, recipient, payload, topicKey, false)
  }

  private async attempt(channel: ApnsChannel, recipient: NotificationRecipient, payload: NotificationPayload, topicKey: string, retried: boolean): Promise<NotificationSendResult> {
    const nowMs = this.now()
    const jwt = this.tokens.getToken(nowMs)
    const built = buildApnsRequest(recipient, payload, jwt, this.defaultBundleId, nowMs)
    if (!built.ok) return built.result

    let reply: Http2Reply
    try {
      reply = await this.post(channel, built.request.headers, built.request.body)
    } catch (error) {
      this.dropSession(channel)
      return { status: 'failed', reason: error instanceof Error && error.message === 'apns_timeout' ? 'apns_timeout' : 'apns_network_error' }
    }

    const res = classifyApnsResponse(reply.status, reply.body, reply.retryAfter, this.now())
    if (res.kind === 'sent') {
      this.keyRejected.delete(channel)
      this.topicRejected.delete(topicKey)
      this.throttled.delete(channel)
      return { status: 'sent' }
    }
    if (res.kind === 'invalid_token') return { status: 'invalid_token', reason: res.reason }
    if (res.kind === 'token_expired') {
      this.tokens.invalidate(jwt)
      if (!retried) return this.attempt(channel, recipient, payload, topicKey, true)
      this.pauseKey(channel, res.reason)
      return { status: 'failed', reason: res.reason }
    }
    if (res.kind === 'key_rejected') {
      this.pauseKey(channel, res.reason)
      return { status: 'failed', reason: res.reason }
    }
    if (res.kind === 'topic_rejected') {
      this.pauseTopic(channel, topicKey, res.reason)
      return { status: 'failed', reason: res.reason }
    }
    if (res.kind === 'throttled') {
      const prev = this.throttled.get(channel)?.attempts ?? 0
      const base = this.opts.throttleBaseMs ?? DEFAULT_THROTTLE_BASE_MS
      const max = this.opts.throttleMaxMs ?? DEFAULT_THROTTLE_MAX_MS
      const delay = res.retryAfterMs ?? Math.min(max, base * 2 ** prev)
      this.throttled.set(channel, { until: this.now() + delay, attempts: prev + 1 })
      return { status: 'failed', reason: res.reason }
    }
    return { status: 'failed', reason: res.reason }
  }

  private pauseKey(channel: ApnsChannel, reason: string) {
    const nowMs = this.now()
    const prev = this.keyRejected.get(channel)
    if (!prev || nowMs >= prev.until) this.log(`[notifications] APNs key rejected by Apple (${reason}) on ${channel}; pausing sends`)
    this.keyRejected.set(channel, { until: nowMs + (this.opts.rejectCooldownMs ?? DEFAULT_REJECT_MS), reason })
  }

  private pauseTopic(channel: ApnsChannel, topicKey: string, reason: string) {
    const nowMs = this.now()
    const prev = this.topicRejected.get(topicKey)
    if (!prev || nowMs >= prev.until) this.log(`[notifications] APNs topic rejected by Apple (${reason}) on ${channel}; pausing topic`)
    this.topicRejected.set(topicKey, { until: nowMs + (this.opts.rejectCooldownMs ?? DEFAULT_REJECT_MS), reason })
  }

  private sessionFor(channel: ApnsChannel): ClientHttp2Session {
    const existing = this.sessions.get(channel)
    if (existing && !existing.closed && !existing.destroyed) return existing
    const session = http2.connect(this.endpoints[channel], this.opts.connectOptions)
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

  private dropSession(channel: ApnsChannel) {
    const session = this.sessions.get(channel)
    if (!session) return
    this.sessions.delete(channel)
    try {
      session.destroy()
    } catch {}
  }

  private post(channel: ApnsChannel, headers: OutgoingHttpHeaders, body: Buffer): Promise<Http2Reply> {
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
      }, this.opts.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS)
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
    this.closed = true
    for (const session of this.sessions.values()) {
      try {
        session.destroy()
      } catch {}
    }
    this.sessions.clear()
  }
}
