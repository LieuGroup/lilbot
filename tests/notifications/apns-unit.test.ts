/** Unit tests for APNs ES256 JWT minting, grapheme-safe 4 KiB payload bounding, and Apple error classification. */
import { expect, test } from 'bun:test'
import { generateKeyPairSync, verify } from 'node:crypto'
import { buildApnsRequest, classifyApnsResponse, parseRetryAfterMs } from '../../server/notifications/apns-payload'
import { APNS_TOKEN_TTL_MS, ApnsTokenProvider } from '../../server/notifications/apns-token'
import type { NotificationPayload, NotificationRecipient } from '../../server/notifications/notification-sender'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const FAKE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const FAKE_KEY_ID = 'FAKEKEY123'
const FAKE_TEAM_ID = 'FAKETEAM99'
const VALID_HEX_TOKEN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

function makePayload(overrides: Partial<NotificationPayload> = {}): NotificationPayload {
  return {
    kind: 'reply',
    title: 'Chief of Staff',
    body: 'Sent a reply',
    threadId: 'bot:b1',
    collapseId: 'reply:b1',
    priority: 'normal',
    target: { kind: 'bot', botId: 'b1' },
    dedupeKey: 'reply:c1:r1',
    createdAt: 1_700_000_000_000,
    ...overrides
  }
}

function makeRecipient(overrides: Partial<NotificationRecipient> = {}): NotificationRecipient {
  return { deviceId: '11111111-1111-4111-8111-111111111111', channel: 'apns', token: VALID_HEX_TOKEN, bundleId: 'com.lilbot.app', ...overrides }
}

test('ApnsTokenProvider mints verifiable ES256 JWTs, caches for 45 min, validates credentials, and safely invalidates', () => {
  const provider = new ApnsTokenProvider({ keyId: FAKE_KEY_ID, teamId: FAKE_TEAM_ID, privateKeyPem: FAKE_PEM })
  const t0 = 1_700_000_000_000
  const jwt1 = provider.getToken(t0)
  const [h, p, s] = jwt1.split('.')
  expect(JSON.parse(Buffer.from(h!, 'base64url').toString('utf8'))).toEqual({ alg: 'ES256', kid: FAKE_KEY_ID })
  expect(JSON.parse(Buffer.from(p!, 'base64url').toString('utf8'))).toEqual({ iss: FAKE_TEAM_ID, iat: Math.floor(t0 / 1000) })
  const sig = Buffer.from(s!, 'base64url')
  expect(sig.length).toBe(64)
  expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, sig)).toBe(true)

  expect(provider.getToken(t0 + 10 * 60_000)).toBe(jwt1)
  provider.invalidate('not-matching-jwt')
  expect(provider.getToken(t0 + 10 * 60_000)).toBe(jwt1)
  provider.invalidate(jwt1)
  const jwt2 = provider.getToken(t0 + 10_000)
  expect(jwt2).not.toBe(jwt1)
  expect(provider.getToken(t0 + 10_000 + APNS_TOKEN_TTL_MS)).not.toBe(jwt2)

  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  expect(() => new ApnsTokenProvider({ keyId: 'SHORT', teamId: FAKE_TEAM_ID, privateKeyPem: FAKE_PEM })).toThrow()
  expect(() => new ApnsTokenProvider({ keyId: FAKE_KEY_ID, teamId: 'BAD_TEAM!', privateKeyPem: FAKE_PEM })).toThrow()
  expect(() => new ApnsTokenProvider({ keyId: FAKE_KEY_ID, teamId: FAKE_TEAM_ID, privateKeyPem: rsa })).toThrow()
})

test('buildApnsRequest bounds payloads <= 4096 bytes on grapheme clusters (family emoji, flags, combining accents) and oversized titles', () => {
  const built = buildApnsRequest(makeRecipient(), makePayload(), 'jwt-1', undefined, 1_700_000_000_000)
  expect(built.ok).toBe(true)
  if (!built.ok) return
  expect(built.request.headers[':path']).toBe(`/3/device/${VALID_HEX_TOKEN}`)
  expect(built.request.headers.authorization).toBe('bearer jwt-1')
  expect(built.request.headers['apns-topic']).toBe('com.lilbot.app')
  expect(built.request.headers['apns-push-type']).toBe('alert')
  expect(built.request.headers['apns-priority']).toBe('10')
  expect(built.request.headers['apns-collapse-id']).toBe('reply:b1')
  expect(JSON.parse(built.request.body.toString('utf8'))).toEqual({
    aps: { alert: { title: 'Chief of Staff', body: 'Sent a reply' }, sound: 'default', 'thread-id': 'bot:b1' },
    kind: 'reply',
    target: { kind: 'bot', botId: 'b1' }
  })

  // Whole grapheme clusters never split: ZWJ family, regional flag, combining accent, and surrogate emoji.
  for (const [unit, count] of [
    ['👨‍👩‍👧‍👦', 300],
    ['🇦🇺', 700],
    ['e\u0301', 1800],
    ['🚀', 1500]
  ] as const) {
    const res = buildApnsRequest(makeRecipient(), makePayload({ body: unit.repeat(count) }), 'jwt-1', undefined, 1_700_000_000_000)
    expect(res.ok).toBe(true)
    if (!res.ok) continue
    expect(res.request.body.byteLength).toBeLessThanOrEqual(4096)
    const { body } = (JSON.parse(res.request.body.toString('utf8')) as { aps: { alert: { body: string } } }).aps.alert
    expect(body.endsWith('…')).toBe(true)
    const prefix = body.slice(0, -1)
    expect(prefix.length).toBeGreaterThan(0)
    expect(prefix.split(unit).every(part => part === '')).toBe(true)
  }

  // Oversized title is also clamped so total payload never exceeds 4096 bytes.
  const bigTitle = buildApnsRequest(makeRecipient(), makePayload({ title: '👨‍👩‍👧‍👦'.repeat(400), body: 'Done' }), 'jwt-1', undefined, 1_700_000_000_000)
  expect(bigTitle.ok).toBe(true)
  if (bigTitle.ok) {
    expect(bigTitle.request.body.byteLength).toBeLessThanOrEqual(4096)
    const parsed = JSON.parse(bigTitle.request.body.toString('utf8')) as { aps: { alert: { title: string; body: string } } }
    expect(parsed.aps.alert.title.endsWith('…')).toBe(true)
    expect(
      parsed.aps.alert.title
        .slice(0, -1)
        .split('👨‍👩‍👧‍👦')
        .every(part => part === '')
    ).toBe(true)
  }

  expect(buildApnsRequest(makeRecipient({ token: 'not-a-hex-token!' }), makePayload(), 'jwt-1', undefined, 0)).toEqual({
    ok: false,
    result: { status: 'invalid_token', reason: 'malformed_apns_token' }
  })
  expect(buildApnsRequest(makeRecipient({ bundleId: '' }), makePayload(), 'jwt-1', undefined, 0)).toEqual({
    ok: false,
    result: { status: 'failed', reason: 'missing_topic' }
  })
})

test('classifyApnsResponse and parseRetryAfterMs map Apple APNs status/reasons accurately', () => {
  const now = 1_700_000_000_000
  expect(classifyApnsResponse(200, '', undefined, now)).toEqual({ kind: 'sent' })
  expect(classifyApnsResponse(410, '{"reason":"Unregistered"}', undefined, now)).toEqual({ kind: 'invalid_token', reason: 'Unregistered' })
  expect(classifyApnsResponse(400, '{"reason":"BadDeviceToken"}', undefined, now)).toEqual({ kind: 'invalid_token', reason: 'BadDeviceToken' })
  expect(classifyApnsResponse(400, '{"reason":"DeviceTokenNotForTopic"}', undefined, now)).toEqual({ kind: 'invalid_token', reason: 'DeviceTokenNotForTopic' })
  expect(classifyApnsResponse(403, '{"reason":"ExpiredProviderToken"}', undefined, now)).toEqual({ kind: 'token_expired', reason: 'ExpiredProviderToken' })
  expect(classifyApnsResponse(403, '{"reason":"InvalidProviderToken"}', undefined, now)).toEqual({ kind: 'key_rejected', reason: 'InvalidProviderToken' })
  expect(classifyApnsResponse(400, '{"reason":"TopicDisallowed"}', undefined, now)).toEqual({ kind: 'topic_rejected', reason: 'TopicDisallowed' })
  expect(classifyApnsResponse(429, '{"reason":"TooManyRequests"}', '45', now)).toEqual({ kind: 'throttled', reason: 'TooManyRequests', retryAfterMs: 45_000 })
  expect(classifyApnsResponse(503, '{"reason":"ServiceUnavailable"}', undefined, now)).toEqual({ kind: 'throttled', reason: 'ServiceUnavailable', retryAfterMs: null })
  expect(classifyApnsResponse(413, '{"reason":"PayloadTooLarge"}', undefined, now)).toEqual({ kind: 'failed', reason: 'PayloadTooLarge' })
  expect(parseRetryAfterMs('999999', now)).toBe(15 * 60_000)
  expect(parseRetryAfterMs('0', now)).toBe(1_000)
  expect(parseRetryAfterMs(new Date(now + 30_000).toUTCString(), now)).toBe(30_000)
})
