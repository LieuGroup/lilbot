import { expect, test } from 'bun:test'
import { unsafeReason } from '../../server/memory/memory-safety'
import { bestCpuMs, scalingRatio } from '../helpers/cpu-time'

const SMALL = 64 * 1024
const SIZE = 256 * 1024
const repeat = (unit: string, size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size)

// One webhook body is scanned on the server's only thread: every rule must stay linear (it was 4.4 s for `-eyJ`). The worst
// shape costs ~25–30 ms of thread CPU at 256 KiB and scales ~4x from 64 KiB, so both the 100 ms budget and the <9x scaling
// bound catch quadratic regressions (~16x / seconds) without flaking under parallel test runs.
const CPU_BUDGET_MS = 100
const MAX_LINEAR_RATIO = 9

function expectLinearScan(make: (size: number) => string) {
  const large = make(SIZE)
  const largeMs = bestCpuMs(() => unsafeReason(large), CPU_BUDGET_MS)
  expect(largeMs).toBeLessThan(CPU_BUDGET_MS)
  const small = make(SMALL)
  const ratio = scalingRatio(
    () => unsafeReason(small),
    () => unsafeReason(large),
    largeMs
  )
  if (ratio !== null) expect(ratio).toBeLessThan(MAX_LINEAR_RATIO)
}

test('every safety rule scans a 256 KiB adversarial text in well under a second', () => {
  const shapes: ((size: number) => string)[] = [
    n => repeat('-eyJ', n),
    n => repeat('eyJ0eXAiOiJKV1QiLCJhbGciOi.', n),
    n => repeat('sk-', n),
    n => `token${' '.repeat(n)}`,
    n => `pass${' '.repeat(n)}`,
    n => repeat('token ', n),
    n => repeat('pass ', n),
    n => repeat('pass= ', n),
    n => repeat(`pass=\${{ `, n),
    n => repeat('DB_PASS={{ ', n),
    n => repeat('DB_PASS=$( ', n),
    n => repeat('DB_PASS= ', n),
    n => repeat('page_token=Cg0IARIG ', n),
    n => repeat('"password": "" ', n),
    n => repeat('"password": {', n),
    n => `${repeat('"password": {', n).slice(0, n - 1)}}`,
    n => repeat('"password": {"a":1} ', n),
    n => `${'['.repeat(Math.floor((20_000 * n) / SIZE))}${']'.repeat(Math.floor((20_000 * n) / SIZE))}`,
    n => repeat('{"key": "DB_PASSWORD", "value": ""} ', n),
    n => repeat('\\"password\\":\\"\\" ', n),
    n => `${repeat('a_', n).slice(0, n - 12)}pass=12345`,
    n => `password="${'a'.repeat(n)}`,
    n => `\\"password\\":\\"${'a'.repeat(n)}`,
    n => repeat('token: string ', n),
    n => repeat('ignore ', n),
    n => repeat('curl ', n),
    n => repeat('do not tell ', n),
    n => repeat('A-b_c9', n),
    n => repeat('\\', n),
    n => repeat('/hook/', n),
    n => repeat('%2Fhook', n)
  ]
  for (const make of shapes) expectLinearScan(make)
})

test('the rewritten token rule still finds real tokens', () => {
  expect(unsafeReason('a JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig')).toContain('access key or token')
  expect(unsafeReason('{"jwt":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"}')).toContain('access key or token')
  expect(unsafeReason('a-word-eyJ-not-a-token')).toBeNull()
})

test('the control and variation-selector rule is linear on 256 KiB', () => {
  const shapes: ((size: number) => string)[] = [
    n => repeat('\u0085', n),
    n => repeat('a\u{E0100}', n),
    n => repeat('️', n),
    n => repeat('\u{1F3F4}\u{E0067}', n),
    n => `${'a'.repeat(n)}\u007F`
  ]
  for (const make of shapes) expectLinearScan(make)
})
