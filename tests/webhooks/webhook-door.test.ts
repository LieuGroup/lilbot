import { expect, spyOn, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { WEBHOOK_LIMITS } from '../../server/webhooks/webhook-limits'
import { doorFixture, unsigned } from './webhook-fixture'

const randomToken = () => randomBytes(48).toString('base64url')
/** Everything a sender can observe about an answer except its date. */
const seen = async (response: Response) => ({
  status: response.status,
  text: await response.text(),
  headers: [...response.headers].filter(([name]) => name !== 'date').sort()
})

test('unknown, malformed, deleted and regenerated addresses, other methods and queries: the same 404 as any path, or 403', async () => {
  const f = doorFixture()
  try {
    const hook = await f.webhooks.create('b1', unsigned)
    const path = new URL(hook.address).pathname
    const notFound = await seen(await f.post('/nothing-here', 'x'))
    expect(notFound.status).toBe(404)
    expect(await seen(await f.post(`/hook/${randomToken()}`, 'x'))).toEqual(notFound)
    expect(await seen(await f.post(`/hook/${f.token(hook.address).slice(1)}`, 'x'))).toEqual(notFound)
    expect(await seen(await f.post(path, undefined as unknown as string, {}, 'GET'))).toEqual(notFound)
    expect((await f.post(`${path}?a=1`, 'x')).status).toBe(403)
    expect((await f.post(path, 'x', { origin: 'https://evil.example' })).status).toBe(403)
    const renewed = await f.webhooks.newAddress('b1', hook.id)
    expect(await seen(await f.post(path, 'x'))).toEqual(notFound)
    expect((await f.post(new URL(renewed.address).pathname, 'x')).status).toBe(202)
    await f.webhooks.delete('b1', hook.id)
    expect(await seen(await f.post(new URL(renewed.address).pathname, 'x'))).toEqual(notFound)
    expect(f.database.query('SELECT COUNT(*) AS n FROM webhook_events').get()).toEqual({ n: 0 })
  } finally {
    f.close()
  }
})

test('a signed webhook refuses unsigned and wrongly signed deliveries, keeps nothing of them and logs once a minute', async () => {
  const f = doorFixture()
  const warn = spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const hook = await f.webhooks.create('b1', { ...unsigned, signing: { scheme: 'github' } })
    const path = new URL(hook.address).pathname
    const text = '{"action":"labeled"}'
    expect((await f.post(path, text)).status).toBe(401)
    for (let i = 0; i < 5; i++) expect((await f.post(path, text, { 'x-hub-signature-256': f.signed('wrong-secret-wrong-secret', text) })).status).toBe(401)
    expect(warn.mock.calls.map(call => String(call[0]))).toEqual([`[webhooks] refused an unsigned or wrongly signed delivery for webhook ${hook.id}`])
    expect(f.database.query('SELECT COUNT(*) AS n FROM webhook_events').get()).toEqual({ n: 0 })
    const ok = await f.post(path, text, { 'x-hub-signature-256': f.signed(hook.signingSecret!, text), 'x-github-delivery': 'delivery-1' })
    expect([ok.status, await ok.text()]).toEqual([202, 'Accepted'])
    const again = await f.post(path, text, { 'x-hub-signature-256': f.signed(hook.signingSecret!, text), 'x-github-delivery': 'delivery-1' })
    expect([again.status, await again.text()]).toEqual([202, 'Already received'])
    expect(f.store.events.waiting(hook.id).count).toBe(1)
    expect((await f.webhooks.list('b1'))[0].lastEventAt).not.toBeNull()
  } finally {
    warn.mockRestore()
    f.close()
  }
})

test('paused refuses at once; resumed accepts again', async () => {
  const f = doorFixture()
  try {
    const hook = await f.webhooks.create('b1', unsigned)
    const path = new URL(hook.address).pathname
    await f.webhooks.pause('b1', hook.id, true)
    expect((await f.post(path, 'x')).status).toBe(409)
    await f.webhooks.pause('b1', hook.id, false)
    expect((await f.post(path, 'x')).status).toBe(202)
  } finally {
    f.close()
  }
})

test('body cap: over-size deliveries get 413, by Content-Length or streamed; the helper routes keep 8 KiB', async () => {
  const f = doorFixture()
  try {
    const hook = await f.webhooks.create('b1', unsigned)
    const path = new URL(hook.address).pathname
    expect((await f.post(path, 'x'.repeat(WEBHOOK_LIMITS.bodyBytes))).status).toBe(202)
    expect((await f.post(path, 'x'.repeat(WEBHOOK_LIMITS.bodyBytes + 1))).status).toBe(413)
    const stream = (bytes: number) =>
      new ReadableStream({
        start(controller) {
          for (let sent = 0; sent < bytes; sent += 1024) controller.enqueue(new Uint8Array(Math.min(1024, bytes - sent)))
          controller.close()
        }
      })
    expect((await f.post(path, stream(WEBHOOK_LIMITS.bodyBytes + 4096))).status).toBe(413)
    expect((await f.post('/helper/register', 'x'.repeat(9 * 1024))).status).toBe(413)
    expect((await f.post('/helper/register', stream(9 * 1024))).status).toBe(413)
    expect((await f.post('/helper/register', '{}')).status).toBe(403)
    expect(f.store.events.waiting(hook.id).count).toBe(1)
  } finally {
    f.close()
  }
})

test('rate limits: per webhook once verified, and per client address (cf-connecting-ip) before the lookup', async () => {
  const f = doorFixture()
  try {
    const hook = await f.webhooks.create('b1', unsigned)
    const path = new URL(hook.address).pathname
    const statuses: number[] = []
    for (let i = 0; i <= WEBHOOK_LIMITS.perWebhookPerMinute; i++) statuses.push((await f.post(path, `${i}`, { 'cf-connecting-ip': `198.51.100.${i % 200}` })).status)
    expect(statuses.filter(status => status === 202)).toHaveLength(WEBHOOK_LIMITS.perWebhookPerMinute)
    expect(statuses.at(-1)).toBe(429)
    const guesses: number[] = []
    for (let i = 0; i <= WEBHOOK_LIMITS.perAddressPerMinute; i++) guesses.push((await f.post(`/hook/${randomToken()}`, 'x', { 'cf-connecting-ip': '203.0.113.9' })).status)
    expect(guesses.filter(status => status === 404)).toHaveLength(WEBHOOK_LIMITS.perAddressPerMinute)
    expect(guesses.at(-1)).toBe(429)
    expect((await f.post(`/hook/${randomToken()}`, 'x', { 'cf-connecting-ip': '203.0.113.10' })).status).toBe(404)
  } finally {
    f.close()
  }
})
