/** Unit tests for APNs ES256 JWT minting, 4 KiB payload building, Apple error classification, and env/dev safety guards. */
import { expect, test } from 'bun:test'
import { generateKeyPairSync, verify } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertDevelopmentTarget } from '../../server/environment'
import { buildApnsRequest, classifyApnsResponse, parseRetryAfterMs } from '../../server/notifications/apns-payload'
import { createApnsSenderFromEnv } from '../../server/notifications/apns-settings'
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

  // Reused within TTL; stale invalidate mismatch keeps cached token; matching invalidate forces fresh token; refreshed past TTL.
  expect(provider.getToken(t0 + 10 * 60_000)).toBe(jwt1)
  provider.invalidate('not-matching-jwt')
  expect(provider.getToken(t0 + 10 * 60_000)).toBe(jwt1)
  provider.invalidate(jwt1)
  const jwt2 = provider.getToken(t0 + 10_000)
  expect(jwt2).not.toBe(jwt1)
  expect(provider.getToken(t0 + 10_000 + APNS_TOKEN_TTL_MS)).not.toBe(jwt2)

  // Rejects bad key/team IDs and non-P256 keys.
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  expect(() => new ApnsTokenProvider({ keyId: 'SHORT', teamId: FAKE_TEAM_ID, privateKeyPem: FAKE_PEM })).toThrow()
  expect(() => new ApnsTokenProvider({ keyId: FAKE_KEY_ID, teamId: 'BAD_TEAM!', privateKeyPem: FAKE_PEM })).toThrow()
  expect(() => new ApnsTokenProvider({ keyId: FAKE_KEY_ID, teamId: FAKE_TEAM_ID, privateKeyPem: rsa })).toThrow()
})

test('buildApnsRequest formats headers/body, bounds payloads to 4096 bytes without splitting emojis, and rejects malformed inputs', () => {
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

  // Huge multi-byte emoji payload stays <= 4096 bytes with valid UTF-8 (zero replacement chars).
  const huge = buildApnsRequest(makeRecipient(), makePayload({ body: '🚀'.repeat(2000) }), 'jwt-1', undefined, 1_700_000_000_000)
  expect(huge.ok).toBe(true)
  if (huge.ok) {
    expect(huge.request.body.byteLength).toBeLessThanOrEqual(4096)
    const parsed = JSON.parse(huge.request.body.toString('utf8')) as { aps: { alert: { body: string } } }
    expect(parsed.aps.alert.body.includes('\uFFFD')).toBe(false)
    expect(parsed.aps.alert.body.endsWith('…')).toBe(true)
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

test('createApnsSenderFromEnv stays off unless configured in production, never logs secrets, and dev guard blocks prod key path', () => {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-apns-env-'))
  try {
    const keyPath = join(root, 'fake.p8')
    writeFileSync(keyPath, FAKE_PEM, { mode: 0o600 })
    const logs: string[] = []
    const log = (msg: string) => logs.push(msg)

    // Absent settings -> silently off.
    expect(createApnsSenderFromEnv({ LILBOT_ENV: 'production' }, log)).toBeNull()
    expect(logs).toEqual([])

    // Development refuses enabling APNs even with valid key settings.
    expect(
      createApnsSenderFromEnv({ LILBOT_ENV: 'development', LILBOT_APNS_KEY_PATH: keyPath, LILBOT_APNS_KEY_ID: FAKE_KEY_ID, LILBOT_APNS_TEAM_ID: FAKE_TEAM_ID }, log)
    ).toBeNull()
    expect(logs.at(-1)).toContain('disabled outside production')

    // Partial or bad production settings disable gracefully without throwing or leaking secrets.
    expect(createApnsSenderFromEnv({ LILBOT_ENV: 'production', LILBOT_APNS_KEY_PATH: keyPath }, log)).toBeNull()
    expect(
      createApnsSenderFromEnv({ LILBOT_ENV: 'production', LILBOT_APNS_KEY_PATH: join(root, 'missing.p8'), LILBOT_APNS_KEY_ID: FAKE_KEY_ID, LILBOT_APNS_TEAM_ID: FAKE_TEAM_ID }, log)
    ).toBeNull()
    expect(logs.join('\n')).not.toContain(FAKE_KEY_ID)
    expect(logs.join('\n')).not.toContain(FAKE_TEAM_ID)
    expect(logs.join('\n')).not.toContain('BEGIN PRIVATE KEY')

    // Valid production config builds sender covering apns + apns_sandbox.
    const sender = createApnsSenderFromEnv(
      { LILBOT_ENV: 'production', LILBOT_APNS_KEY_PATH: keyPath, LILBOT_APNS_KEY_ID: FAKE_KEY_ID, LILBOT_APNS_TEAM_ID: FAKE_TEAM_ID, LILBOT_APNS_BUNDLE_ID: 'com.lilbot.app' },
      log
    )
    expect(sender?.channels).toEqual(['apns', 'apns_sandbox'])

    // Development environment guard refuses LILBOT_APNS_KEY_PATH inside production data dir.
    expect(() => assertDevelopmentTarget({ LILBOT_ENV: 'development', LILBOT_APNS_KEY_PATH: join(homedir(), '.local/share/lilbot/apns/key.p8') })).toThrow(
      'Development refuses production path: LILBOT_APNS_KEY_PATH'
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
