import { expect, test } from 'bun:test'
import { WEBHOOK_LIMITS } from '../../server/webhooks/webhook-limits'
import { eventView } from '../../server/webhooks/webhook-payload'
import { cpuMs, cpuNow } from '../helpers/cpu-time'
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

/** The most CPU the process spent between two turns of a 5 ms timer while `work` runs: how long running code held the event
 *  loop. Not wall time, which a busy machine stretches whatever the code does. */
async function longestHold(work: () => Promise<unknown>) {
  let last = cpuNow()
  let longest = 0
  const timer = setInterval(() => {
    const now = cpuNow()
    longest = Math.max(longest, now - last)
    last = now
  }, 5)
  try {
    await work()
  } finally {
    clearInterval(timer)
  }
  return Math.max(longest, cpuNow() - last)
}

const view = (text: string, headers: Record<string, string>) => eventView(new TextEncoder().encode(text), new Headers(headers), null, 0, 'Q'.repeat(64))

// Preparing an event is synchronous: a minute's budget of these arriving together once held the server for 5 to 7 s,
// with every other request waiting. Each is now prepared in its own turn of the event loop, so the loop is held for about
// one preparation at a time, not sixty. The bound is a multiple of one body's own CPU time, measured here first: it follows
// the machine's speed, and CPU time ignores that other processes are running (wall time would not). A healthy run holds the
// loop for 1 to 2.5 preparations; the sixty at once it once did hold it for would be 60.
const HOLD_LIMIT = 8
for (const [name, body, headers] of SHAPES)
  test(`a minute of deliveries of ${name} at once never holds the server for long`, async () => {
    const f = doorFixture()
    try {
      const path = new URL((await f.webhooks.create('b1', unsigned)).address).pathname
      const bodies = Array.from({ length: WEBHOOK_LIMITS.perWebhookPerMinute }, (_, i) => body(i))
      expect(Math.max(...bodies.map(text => new TextEncoder().encode(text).length))).toBeLessThanOrEqual(SIZE)
      const one = Math.min(...[0, 1].map(() => cpuMs(() => view(bodies[0], headers))))
      let unrelated = 0
      const hold = await longestHold(async () => {
        const answers = Promise.all(bodies.map(text => f.post(path, text, headers)))
        await new Promise(resolve => setTimeout(resolve, 100))
        const other = cpuNow()
        await f.post('/nothing', '')
        unrelated = cpuNow() - other
        expect((await answers).map(answer => answer.status)).toEqual(bodies.map(() => 202))
      })
      expect(hold).toBeLessThan(HOLD_LIMIT * one)
      expect(unrelated).toBeLessThan(HOLD_LIMIT * one)
    } finally {
      f.close()
    }
  }, 30_000)
