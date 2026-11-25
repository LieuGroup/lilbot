/** Loopback HTTP/2 mock tests for ApnsSender: sandbox routing, endpoint deletion, rejection breakers, backoff, expiry retry, and reconnects. */
import { expect, test } from 'bun:test'
import { generateKeyPairSync, verify } from 'node:crypto'
import { openDatabase } from '../../server/database/database'
import { DeviceStore } from '../../server/devices/device-store'
import { ApnsSender } from '../../server/notifications/apns-sender'
import type { NotificationPayload, NotificationRecipient } from '../../server/notifications/notification-sender'
import { NotificationService } from '../../server/notifications/notification-service'
import { NotificationStore } from '../../server/notifications/notification-store'
import { startMockApns } from './apns-mock'

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const FAKE_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
const FAKE_KEY_ID = 'FAKEKEY123'
const FAKE_TEAM_ID = 'FAKETEAM99'
const D1 = '11111111-1111-4111-8111-111111111111'
const D2 = '22222222-2222-4222-8222-222222222222'
const TOK1 = '1111111111111111111111111111111111111111111111111111111111111111'
const TOK2 = '2222222222222222222222222222222222222222222222222222222222222222'

function verifyBearerJwt(authHeader: string) {
  expect(authHeader.startsWith('bearer ')).toBe(true)
  const [h, p, s] = authHeader.slice(7).split('.')
  expect(verify('sha256', Buffer.from(`${h}.${p}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s!, 'base64url'))).toBe(true)
}

function payload(dedupeKey: string): NotificationPayload {
  return {
    kind: 'reply',
    title: 'Chief of Staff',
    body: 'Sent a reply',
    threadId: 'bot:b1',
    collapseId: 'reply:b1',
    priority: 'normal',
    target: { kind: 'bot', botId: 'b1' },
    dedupeKey,
    createdAt: 1_700_000_000_000
  }
}

test('ApnsSender routes apns vs apns_sandbox per endpoint, reuses HTTP/2 sessions, and deletes invalid tokens via NotificationService', async () => {
  let prodMode: 'ok' | 'unregistered' = 'ok'
  const prod = await startMockApns(() => (prodMode === 'ok' ? { status: 200 } : { status: 410, body: '{"reason":"Unregistered"}' }))
  const sandbox = await startMockApns(() => ({ status: 200 }))
  const sender = new ApnsSender({ keyId: FAKE_KEY_ID, teamId: FAKE_TEAM_ID, privateKeyPem: FAKE_PEM, endpoints: { apns: prod.origin, apns_sandbox: sandbox.origin } })
  try {
    const db = openDatabase(':memory:')
    const devices = new DeviceStore(db)
    devices.touch(D1, 'Prod Phone', 1000)
    devices.touch(D2, 'Debug Phone', 1000)
    const service = new NotificationService(new NotificationStore(db), sender, {
      deviceExists: id => Boolean(devices.get(id)),
      botName: () => 'Chief of Staff',
      replyCooldownMs: 0
    })
    service.register(D1, 'apns', TOK1, 'com.lilbot.app')
    service.register(D2, 'apns_sandbox', TOK2, 'com.lilbot.app.dev')

    const res1 = await service.notifyReply({ botId: 'b1', chatId: 'c1', text: 'Hi', dedupeKey: 'r1' })
    expect(res1).toEqual({ sent: 2, suppressed: 0, deduped: 0, failed: 0 })
    expect(prod.hits).toHaveLength(1)
    expect(sandbox.hits).toHaveLength(1)
    expect(prod.hits[0]!.path).toBe(`/3/device/${TOK1}`)
    expect(prod.hits[0]!.topic).toBe('com.lilbot.app')
    expect(sandbox.hits[0]!.path).toBe(`/3/device/${TOK2}`)
    expect(sandbox.hits[0]!.topic).toBe('com.lilbot.app.dev')
    verifyBearerJwt(prod.hits[0]!.auth)
    verifyBearerJwt(sandbox.hits[0]!.auth)

    // Persistent HTTP/2 connection reused on second push; 410 Unregistered deletes D1's endpoint outright.
    prodMode = 'unregistered'
    const res2 = await service.notifyReply({ botId: 'b1', chatId: 'c1', text: 'Second', dedupeKey: 'r2' })
    expect(res2).toEqual({ sent: 1, suppressed: 0, deduped: 0, failed: 1 })
    expect(prod.sessionCount()).toBe(1)
    expect(sandbox.sessionCount()).toBe(1)
    expect(service.getSettings(D1).endpoints).toEqual([])
    expect(db.query('SELECT COUNT(*) AS n FROM notification_endpoints WHERE device_id = ?').get(D1)).toEqual({ n: 0 })

    // Next push never contacts prod again for the removed endpoint.
    const res3 = await service.notifyReply({ botId: 'b1', chatId: 'c1', text: 'Third', dedupeKey: 'r3' })
    expect(res3).toEqual({ sent: 1, suppressed: 0, deduped: 0, failed: 0 })
    expect(prod.hits).toHaveLength(2)
    expect(sandbox.hits).toHaveLength(3)
  } finally {
    sender.close()
    await Promise.all([prod.close(), sandbox.close()])
  }
})

test('ApnsSender pauses rejected keys/topics once without retry storms, backs off on 429/503, refreshes expired JWTs, and recovers from GOAWAY/timeout', async () => {
  let clock = 1_700_000_000_000
  let prodBehavior: 'ok' | 'topic_bad' | 'expired_once' | 'throttle' | 'unavail' | 'goaway' | 'hang' = 'ok'
  let expiredTriggered = false
  const prod = await startMockApns(hit => {
    if (prodBehavior === 'topic_bad' && hit.topic === 'com.bad.topic') return { status: 400, body: '{"reason":"TopicDisallowed"}' }
    if (prodBehavior === 'expired_once' && !expiredTriggered) {
      expiredTriggered = true
      return { status: 403, body: '{"reason":"ExpiredProviderToken"}' }
    }
    if (prodBehavior === 'throttle') return { status: 429, body: '{"reason":"TooManyRequests"}', headers: { 'retry-after': '10' } }
    if (prodBehavior === 'unavail') return { status: 503, body: '{"reason":"ServiceUnavailable"}' }
    if (prodBehavior === 'goaway') return { status: 200, goaway: true }
    if (prodBehavior === 'hang') return { status: 200, hang: true }
    return { status: 200 }
  })
  const sandbox = await startMockApns(() => ({ status: 403, body: '{"reason":"InvalidProviderToken"}' }))
  const logs: string[] = []
  const sender = new ApnsSender({
    keyId: FAKE_KEY_ID,
    teamId: FAKE_TEAM_ID,
    privateKeyPem: FAKE_PEM,
    endpoints: { apns: prod.origin, apns_sandbox: sandbox.origin },
    rejectCooldownMs: 60_000,
    requestTimeoutMs: 60,
    now: () => clock,
    log: msg => logs.push(msg)
  })
  const prodRec = (bundleId = 'com.lilbot.app'): NotificationRecipient => ({ deviceId: D1, channel: 'apns', token: TOK1, bundleId })
  const sbRec: NotificationRecipient = { deviceId: D2, channel: 'apns_sandbox', token: TOK2, bundleId: 'com.lilbot.app' }

  try {
    // 1. Rejected key on sandbox logs ONCE, stops hitting sandbox during cooldown, and never breaks production.
    expect(await sender.send(sbRec, payload('k1'))).toEqual({ status: 'failed', reason: 'InvalidProviderToken' })
    expect(await sender.send(sbRec, payload('k2'))).toEqual({ status: 'failed', reason: 'InvalidProviderToken' })
    expect(await sender.send(sbRec, payload('k3'))).toEqual({ status: 'failed', reason: 'InvalidProviderToken' })
    expect(sandbox.hits).toHaveLength(1)
    expect(logs.filter(l => l.includes('InvalidProviderToken'))).toHaveLength(1)
    expect(logs.join('\n')).not.toContain(FAKE_KEY_ID)
    expect(await sender.send(prodRec(), payload('p1'))).toEqual({ status: 'sent' })

    // 2. Rejected topic logs ONCE and pauses only that topic while valid topics still send.
    prodBehavior = 'topic_bad'
    expect(await sender.send(prodRec('com.bad.topic'), payload('t1'))).toEqual({ status: 'failed', reason: 'TopicDisallowed' })
    expect(await sender.send(prodRec('com.bad.topic'), payload('t2'))).toEqual({ status: 'failed', reason: 'TopicDisallowed' })
    expect(prod.hits.filter(h => h.topic === 'com.bad.topic')).toHaveLength(1)
    expect(logs.filter(l => l.includes('TopicDisallowed'))).toHaveLength(1)
    expect(await sender.send(prodRec('com.lilbot.app'), payload('t3'))).toEqual({ status: 'sent' })

    // 3. ExpiredProviderToken invalidates cached JWT and succeeds on one immediate retry with a fresh token.
    prodBehavior = 'expired_once'
    clock += 1000
    expect(await sender.send(prodRec(), payload('e1'))).toEqual({ status: 'sent' })

    // 4. 429 honors Retry-After (10s); 503 without Retry-After applies exponential backoff (5s -> 10s) and resets on 200.
    prodBehavior = 'throttle'
    const beforeThrottle = prod.hits.length
    expect(await sender.send(prodRec(), payload('th1'))).toEqual({ status: 'failed', reason: 'TooManyRequests' })
    expect(await sender.send(prodRec(), payload('th2'))).toEqual({ status: 'failed', reason: 'apns_throttled' })
    expect(prod.hits.length).toBe(beforeThrottle + 1)
    clock += 10_000
    prodBehavior = 'ok'
    expect(await sender.send(prodRec(), payload('th3'))).toEqual({ status: 'sent' })

    prodBehavior = 'unavail'
    expect(await sender.send(prodRec(), payload('u1'))).toEqual({ status: 'failed', reason: 'ServiceUnavailable' })
    clock += 4_000
    expect(await sender.send(prodRec(), payload('u2'))).toEqual({ status: 'failed', reason: 'apns_throttled' })
    clock += 1_000
    expect(await sender.send(prodRec(), payload('u3'))).toEqual({ status: 'failed', reason: 'ServiceUnavailable' })
    clock += 9_000
    expect(await sender.send(prodRec(), payload('u4'))).toEqual({ status: 'failed', reason: 'apns_throttled' })
    clock += 1_000
    prodBehavior = 'ok'
    expect(await sender.send(prodRec(), payload('u5'))).toEqual({ status: 'sent' })

    // 5. GOAWAY reconnects cleanly on next push; hanging stream times out; close() stops further sends cleanly (kills M14).
    prodBehavior = 'goaway'
    expect(await sender.send(prodRec(), payload('g1'))).toEqual({ status: 'sent' })
    await new Promise(resolve => setTimeout(resolve, 15))
    prodBehavior = 'ok'
    expect(await sender.send(prodRec(), payload('g2'))).toEqual({ status: 'sent' })
    prodBehavior = 'hang'
    expect(await sender.send(prodRec(), payload('h1'))).toEqual({ status: 'failed', reason: 'apns_timeout' })

    const hitsBeforeClose = prod.hits.length
    sender.close()
    expect(await sender.send(prodRec(), payload('after-close'))).toEqual({ status: 'failed', reason: 'apns_closed' })
    expect(prod.hits.length).toBe(hitsBeforeClose)
  } finally {
    sender.close()
    await Promise.all([prod.close(), sandbox.close()])
  }
})
