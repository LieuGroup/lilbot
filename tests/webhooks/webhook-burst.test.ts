import { expect, test } from 'bun:test'
import { WEBHOOK_LIMITS } from '../../server/webhooks/webhook-limits'
import { doorFixture, unsigned } from './webhook-fixture'

const SIZE = WEBHOOK_LIMITS.bodyBytes
const PLAIN = { 'content-type': 'text/plain' }
const FORM = { 'content-type': 'application/x-www-form-urlencoded' }
const keys = (i: number) => {
  let text = ''
  for (let k = 0; text.length < SIZE - 16; k++) text += `${i}k${k}=&`
  return text
}

// The costliest bodies to prepare (escaped one character at a time, expanded 18 times by NFKD, many distinct fields).
const SHAPES: [string, (i: number) => string, Record<string, string>][] = [
  ['DEL in a JSON string', i => JSON.stringify({ i, t: '\u007F'.repeat(SIZE - 40) }), {}],
  ['U+034F in a JSON string', i => JSON.stringify({ i, t: '͏'.repeat(SIZE / 2 - 40) }), {}],
  ['U+FDFA in plain text', i => `${i} ${'ﷺ'.repeat(SIZE / 3 - 40)}`, PLAIN],
  ['a form of distinct keys', keys, FORM]
]

/** The longest stretch the event loop was held, sampled by a 5 ms timer while `work` runs. */
async function longestStall(work: () => Promise<unknown>) {
  let last = performance.now()
  let longest = 0
  const timer = setInterval(() => {
    const now = performance.now()
    longest = Math.max(longest, now - last)
    last = now
  }, 5)
  try {
    await work()
  } finally {
    clearInterval(timer)
  }
  return Math.max(longest, performance.now() - last)
}

// Preparing an event is synchronous: a minute's budget of these arriving together once held the server for 5 to 7 s,
// with every other request waiting. Each is now prepared in its own turn of the event loop.
for (const [name, body, headers] of SHAPES)
  test(`a minute of deliveries of ${name} at once never holds the server for long`, async () => {
    const f = doorFixture()
    try {
      const path = new URL((await f.webhooks.create('b1', unsigned)).address).pathname
      const bodies = Array.from({ length: WEBHOOK_LIMITS.perWebhookPerMinute }, (_, i) => body(i))
      expect(Math.max(...bodies.map(text => new TextEncoder().encode(text).length))).toBeLessThanOrEqual(SIZE)
      let unrelated = 0
      const stall = await longestStall(async () => {
        const started = performance.now()
        const answers = Promise.all(bodies.map(text => f.post(path, text, headers)))
        await new Promise(resolve => setTimeout(resolve, 100))
        const other = performance.now()
        await f.post('/nothing', '')
        unrelated = performance.now() - other
        expect((await answers).map(answer => answer.status)).toEqual(bodies.map(() => 202))
        return performance.now() - started
      })
      expect(stall).toBeLessThan(300)
      expect(unrelated).toBeLessThan(300)
    } finally {
      f.close()
    }
  }, 30_000)
