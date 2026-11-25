/** Direct outbound Apple APNs sender: per-endpoint prod/sandbox routing, JWT refresh, rejection breakers, and throttle backoff. */
import type { SecureClientSessionOptions } from 'node:http2'
import type { NotificationChannel } from '../../shared/notification-schema'
import { type ApnsChannel, ApnsHttp2Pool, type ApnsHttp2Reply, validateApnsOrigin } from './apns-client'
import { buildApnsRequest, classifyApnsResponse } from './apns-payload'
import { type ApnsCredentials, ApnsTokenProvider } from './apns-token'
import type { NotificationPayload, NotificationRecipient, NotificationSender, NotificationSendResult } from './notification-sender'

const DEFAULT_ENDPOINTS: Record<ApnsChannel, string> = { apns: 'https://api.push.apple.com', apns_sandbox: 'https://api.sandbox.push.apple.com' }
const [DEFAULT_REJECT_MS, DEFAULT_THROTTLE_BASE_MS, DEFAULT_THROTTLE_MAX_MS] = [15 * 60_000, 5_000, 5 * 60_000]

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

export class ApnsSender implements NotificationSender {
  readonly channels: readonly NotificationChannel[] = ['apns', 'apns_sandbox']
  private readonly tokens: ApnsTokenProvider
  private readonly pool: ApnsHttp2Pool
  private readonly defaultBundleId?: string
  private readonly now: () => number
  private readonly log: (message: string) => void
  private keyRejected = new Map<ApnsChannel, { until: number; reason: string }>()
  private topicRejected = new Map<string, { until: number; reason: string }>()
  private throttled = new Map<ApnsChannel, { until: number; attempts: number }>()
  private closed = false

  constructor(private readonly opts: ApnsSenderOptions) {
    const production = process.env.LILBOT_ENV === 'production'
    if (production && opts.connectOptions) {
      throw new Error('APNs TLS connection overrides are refused in production')
    }
    this.tokens = new ApnsTokenProvider(opts, opts.tokenTtlMs)
    const endpoints: Record<ApnsChannel, string> = {
      apns: validateApnsOrigin(opts.endpoints?.apns ?? DEFAULT_ENDPOINTS.apns, production),
      apns_sandbox: validateApnsOrigin(opts.endpoints?.apns_sandbox ?? DEFAULT_ENDPOINTS.apns_sandbox, production)
    }
    this.pool = new ApnsHttp2Pool(endpoints, opts.requestTimeoutMs, opts.connectOptions)
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

    let reply: ApnsHttp2Reply
    try {
      reply = await this.pool.post(channel, built.request.headers, built.request.body)
    } catch (error) {
      this.pool.drop(channel)
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

  close() {
    this.closed = true
    this.pool.close()
  }
}
