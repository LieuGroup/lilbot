/** Pure Apple APNs HTTP/2 request builder (4 KiB grapheme-safe payload guard) and response classifier. */
import type { OutgoingHttpHeaders } from 'node:http2'
import type { NotificationPayload, NotificationRecipient, NotificationSendResult } from './notification-sender'

const APNS_HEX_TOKEN = /^[0-9a-fA-F]{32,512}$/
const APNS_TOPIC = /^[A-Za-z0-9.-]{1,200}$/
const MAX_APNS_PAYLOAD_BYTES = 4096
const MAX_COLLAPSE_BYTES = 64
const EXPIRATION_TTL_SECONDS = 24 * 60 * 60
const MIN_RETRY_AFTER_MS = 1_000
const MAX_RETRY_AFTER_MS = 15 * 60_000
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' })

const INVALID_TOKEN_REASONS = new Set(['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'])
const KEY_REJECTED_REASONS = new Set(['InvalidProviderToken', 'MissingProviderToken'])
const TOPIC_REJECTED_REASONS = new Set(['TopicDisallowed', 'BadTopic', 'MissingTopic'])

export interface BuiltApnsRequest {
  topic: string
  headers: OutgoingHttpHeaders
  body: Buffer
}

export type ApnsClassification =
  | { kind: 'sent' }
  | { kind: 'invalid_token'; reason: string }
  | { kind: 'token_expired'; reason: string }
  | { kind: 'key_rejected'; reason: string }
  | { kind: 'topic_rejected'; reason: string }
  | { kind: 'throttled'; reason: string; retryAfterMs: number | null }
  | { kind: 'failed'; reason: string }

function clampGraphemes(raw: string, fits: (text: string) => boolean, fallback: string): string {
  const units = Array.from(GRAPHEMES.segment(raw), part => part.segment)
  let [lo, hi] = [0, units.length]
  let best = fallback
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const text = mid === units.length ? raw : mid === 0 ? fallback : `${units.slice(0, mid).join('').trimEnd()}…`
    if (fits(text)) {
      best = text
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return best
}

function serializeBoundedBody(payload: NotificationPayload): Buffer {
  const make = (title: string, body: string) =>
    Buffer.from(
      JSON.stringify({
        aps: { alert: { title, body }, sound: 'default', 'thread-id': payload.threadId },
        kind: payload.kind,
        target: payload.target
      }),
      'utf8'
    )
  const initial = make(payload.title, payload.body)
  if (initial.byteLength <= MAX_APNS_PAYLOAD_BYTES) return initial

  let title = payload.title
  if (make(title, '…').byteLength > MAX_APNS_PAYLOAD_BYTES) {
    title = clampGraphemes(title, candidate => make(candidate, '…').byteLength <= MAX_APNS_PAYLOAD_BYTES, 'LilBot')
    if (make(title, '…').byteLength > MAX_APNS_PAYLOAD_BYTES) title = 'LilBot'
  }
  const fallbackBody = make(title, '…').byteLength <= MAX_APNS_PAYLOAD_BYTES ? '…' : ''
  const body = clampGraphemes(payload.body, candidate => make(title, candidate).byteLength <= MAX_APNS_PAYLOAD_BYTES, fallbackBody)
  return make(title, body)
}

/** Builds an APNs HTTP/2 POST request or returns a terminal local refusal without opening a network stream. */
export function buildApnsRequest(
  recipient: NotificationRecipient,
  payload: NotificationPayload,
  jwt: string,
  defaultBundleId: string | undefined,
  nowMs: number
): { ok: true; request: BuiltApnsRequest } | { ok: false; result: NotificationSendResult } {
  const token = recipient.token.trim()
  if (!APNS_HEX_TOKEN.test(token)) {
    return { ok: false, result: { status: 'invalid_token', reason: 'malformed_apns_token' } }
  }
  const topic = recipient.bundleId.trim() || defaultBundleId?.trim() || ''
  if (!topic || !APNS_TOPIC.test(topic)) {
    return { ok: false, result: { status: 'failed', reason: topic ? 'invalid_topic' : 'missing_topic' } }
  }
  const headers: OutgoingHttpHeaders = {
    ':method': 'POST',
    ':path': `/3/device/${token}`,
    authorization: `bearer ${jwt}`,
    'apns-topic': topic,
    'apns-push-type': 'alert',
    'apns-priority': '10',
    'apns-expiration': String(Math.floor(nowMs / 1000) + EXPIRATION_TTL_SECONDS),
    'content-type': 'application/json'
  }
  if (payload.collapseId && Buffer.byteLength(payload.collapseId, 'utf8') <= MAX_COLLAPSE_BYTES) {
    headers['apns-collapse-id'] = payload.collapseId
  }
  return { ok: true, request: { topic, headers, body: serializeBoundedBody(payload) } }
}

/** Parses an APNs `retry-after` header (integer seconds or HTTP-date), clamped to `[1s, 15m]`. */
export function parseRetryAfterMs(raw: string | string[] | number | undefined, nowMs: number): number | null {
  const value = Array.isArray(raw) ? raw[0] : raw !== undefined ? String(raw) : undefined
  if (!value?.trim()) return null
  const trimmed = value.trim()
  if (/^\d+$/.test(trimmed)) {
    const ms = Number(trimmed) * 1000
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, ms))
  }
  const parsedDate = Date.parse(trimmed)
  if (Number.isNaN(parsedDate)) return null
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, parsedDate - nowMs))
}

function parseReason(rawBody: string): string {
  if (!rawBody.trim()) return ''
  try {
    const parsed = JSON.parse(rawBody) as { reason?: unknown }
    return typeof parsed.reason === 'string' && parsed.reason.trim() ? parsed.reason.trim() : ''
  } catch {
    return ''
  }
}

/** Classifies an Apple APNs HTTP/2 status code and JSON body into a concrete delivery action. */
export function classifyApnsResponse(status: number, rawBody: string, retryAfterHeader: string | string[] | number | undefined, nowMs: number): ApnsClassification {
  if (status === 200) return { kind: 'sent' }
  const reason = parseReason(rawBody)
  if (status === 410 || (status === 400 && INVALID_TOKEN_REASONS.has(reason))) {
    return { kind: 'invalid_token', reason: reason || 'Unregistered' }
  }
  if (status === 403 && reason === 'ExpiredProviderToken') {
    return { kind: 'token_expired', reason }
  }
  if (status === 403 && KEY_REJECTED_REASONS.has(reason)) {
    return { kind: 'key_rejected', reason }
  }
  if ((status === 400 || status === 403) && TOPIC_REJECTED_REASONS.has(reason)) {
    return { kind: 'topic_rejected', reason }
  }
  if (status === 429 || status === 503 || status === 500) {
    return { kind: 'throttled', reason: reason || `http_${status}`, retryAfterMs: parseRetryAfterMs(retryAfterHeader, nowMs) }
  }
  return { kind: 'failed', reason: reason || `http_${status}` }
}
