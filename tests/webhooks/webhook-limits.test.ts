import { expect, test } from 'bun:test'
import { escapeJson } from '../../server/memory/memory-safety'
import { MAX_DEPTH } from '../../server/webhooks/webhook-decode'
import { WEBHOOK_LIMITS } from '../../server/webhooks/webhook-limits'
import { eventView } from '../../server/webhooks/webhook-payload'
import { runFixture } from './webhook-fixture'

const SIZE = WEBHOOK_LIMITS.bodyBytes
const TOKEN = 'Q'.repeat(64)
const view = (text: string, headers: Record<string, string> = {}) => eventView(new TextEncoder().encode(text), new Headers(headers), null, 0, TOKEN)

// Preparing an event runs on the server's only thread. A 40,000-deep body used to block it for 1.2 s.
test('preparing any body up to the cap stays far below a second: deep, wide, long and many-keyed shapes', () => {
  const shapes: [string, Record<string, string>][] = [
    [`${'['.repeat(40_000)}${']'.repeat(40_000)}`, { 'content-type': 'application/json' }],
    [`${'{"a":'.repeat(30_000)}1${'}'.repeat(30_000)}`, {}],
    [`${'['.repeat(130_000)}${']'.repeat(130_000)}`, { 'content-type': 'text/plain' }],
    [`payload=${'%5B'.repeat(20_000)}${'%5D'.repeat(20_000)}`, { 'content-type': 'application/x-www-form-urlencoded' }],
    [`[${'1,'.repeat(SIZE / 2 - 2)}1]`, {}],
    [`[${'"ab",'.repeat(SIZE / 5 - 2)}"a"]`, {}],
    [`{${Array.from({ length: 20_000 }, (_, i) => `"k${i}":${i}`).join(',')}}`, {}],
    [JSON.stringify({ t: 'x'.repeat(SIZE - 20) }), {}],
    [JSON.stringify({ t: '<'.repeat(SIZE - 20) }), {}],
    [JSON.stringify({ t: '­'.repeat(SIZE / 2 - 20) }), {}],
    [JSON.stringify({ t: TOKEN.repeat(4_000) }), {}],
    ['a=1&'.repeat(SIZE / 4), { 'content-type': 'application/x-www-form-urlencoded' }]
  ]
  for (const [body, headers] of shapes) {
    const started = performance.now()
    const shown = view(body, headers)
    expect(performance.now() - started).toBeLessThan(250)
    expect(shown.size).toBeLessThanOrEqual(WEBHOOK_LIMITS.eventChars)
  }
  expect(view(`${'['.repeat(MAX_DEPTH + 1)}${']'.repeat(MAX_DEPTH + 1)}`).refusal).toContain('nested more than')
  expect(view(`${'['.repeat(MAX_DEPTH)}${']'.repeat(MAX_DEPTH)}`).refusal).toBeNull()
})

test('headers count inside the event cap: many long event headers cannot push an event or a run past its share', () => {
  const headers = Object.fromEntries(Array.from({ length: 70 }, (_, i) => [`x-h${i}-event`, '<'.repeat(200)]))
  const shown = view(JSON.stringify({ t: 'x'.repeat(30_000) }), headers)
  expect(shown.refusal).toBeNull()
  expect(shown.size).toBeLessThanOrEqual(WEBHOOK_LIMITS.eventChars)
  expect(Object.keys(JSON.parse(shown.item).headers)).toHaveLength(8)
})

test('a run takes the oldest events that fit its share; the rest wait for the next run, and the prompt holds the stored strings', async () => {
  const f = await runFixture()
  try {
    const big = (n: number) => JSON.stringify({ n, pad: 'x'.repeat(WEBHOOK_LIMITS.runChars / 2 - 200) })
    for (const n of [1, 2, 3]) f.send(big(n))
    const [first] = f.store.claimDue(f.now() + WEBHOOK_LIMITS.quietMs)
    expect(first.events).toBe(2)
    const { items } = f.store.events.forRun(first.id)
    expect(items.reduce((sum, item) => sum + escapeJson(item).length, 0)).toBeLessThanOrEqual(WEBHOOK_LIMITS.runChars)
    expect(f.store.events.waiting(f.hook.id).count).toBe(1)
    await f.tick(f.now() + WEBHOOK_LIMITS.quietMs)
    expect(f.prompts[0]).toContain(escapeJson(items[1]))
    expect(f.prompts[0].length).toBeLessThan(WEBHOOK_LIMITS.runChars + 5_000)
  } finally {
    f.clean()
  }
})

test('repeats: a signed body is dropped under a new or no id; Stripe dedupes by its signed event id, or its body without one', async () => {
  const github = await runFixture({ requestId: 'gh', description: 'Watch', source: 'GitHub', createdBy: 'oscar', signing: { scheme: 'github' } })
  try {
    expect(github.send('{"action":"opened"}', { 'x-github-delivery': 'one' })).toBe('accepted')
    expect(github.send('{"action":"opened"}', { 'x-github-delivery': 'two' })).toBe('duplicate')
    expect(github.send('{"action":"opened"}')).toBe('duplicate')
    expect(github.send('{"action":"closed"}', { 'x-github-delivery': 'three' })).toBe('accepted')
  } finally {
    github.clean()
  }
  const stripe = await runFixture({ requestId: 'st', description: 'Watch', source: 'Stripe', createdBy: 'oscar', signing: { scheme: 'stripe', secret: 'whsec_test_secret_value' } })
  try {
    expect(stripe.send('{"id":"evt_1","type":"charge.succeeded"}')).toBe('accepted')
    expect(stripe.send('{"id":"evt_1","type":"charge.succeeded"}', { 'x-delivery-id': 'new' })).toBe('duplicate')
    expect(stripe.send('{"type":"charge.succeeded"}')).toBe('accepted')
    expect(stripe.send('{"type":"charge.succeeded"}')).toBe('duplicate')
  } finally {
    stripe.clean()
  }
  const open = await runFixture()
  try {
    expect(open.send('{"alert":"down"}')).toBe('accepted')
    expect(open.send('{"alert":"down"}')).toBe('accepted')
  } finally {
    open.clean()
  }
})
