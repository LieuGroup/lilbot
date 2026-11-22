import { expect, test } from 'bun:test'
import { unsafeReason } from '../../server/memory/memory-safety'
import { cpuMs } from '../helpers/cpu-time'

const SIZE = 256 * 1024
const repeat = (unit: string) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE)

// One webhook body is scanned on the server's only thread: every rule must stay linear (it was 4.4 s for `-eyJ`). The worst
// shape costs 25 ms of CPU, so the bound is four times that and a fortieth of the quadratic rule's 4.4 s. It is CPU time, since
// a busy machine stretches the wall time of the same scan several times over.
const CPU_BUDGET_MS = 100

test('every safety rule scans a 256 KiB adversarial text in well under a second', () => {
  for (const text of [
    repeat('-eyJ'),
    repeat('eyJ0eXAiOiJKV1QiLCJhbGciOi.'),
    repeat('sk-'),
    `token${' '.repeat(SIZE)}`,
    `pass${' '.repeat(SIZE)}`,
    repeat('token '),
    repeat('pass '),
    repeat('pass= '),
    repeat('DB_PASS= '),
    repeat('page_token=Cg0IARIG '),
    repeat('"password": "" '),
    repeat('"password": {'),
    repeat('\\"password\\":\\"\\" '),
    `${repeat('a_').slice(0, SIZE - 12)}pass=12345`,
    `password="${'a'.repeat(SIZE)}`,
    `\\"password\\":\\"${'a'.repeat(SIZE)}`,
    repeat('token: string '),
    repeat('ignore '),
    repeat('curl '),
    repeat('do not tell '),
    repeat('A-b_c9'),
    repeat('\\'),
    repeat('/hook/'),
    repeat('%2Fhook')
  ]) {
    expect(cpuMs(() => unsafeReason(text))).toBeLessThan(CPU_BUDGET_MS)
  }
})

test('the rewritten token rule still finds real tokens', () => {
  expect(unsafeReason('a JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig')).toContain('access key or token')
  expect(unsafeReason('{"jwt":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"}')).toContain('access key or token')
  expect(unsafeReason('a-word-eyJ-not-a-token')).toBeNull()
})

test('the control and variation-selector rule is linear on 256 KiB', () => {
  for (const text of [repeat('\u0085'), repeat('a\u{E0100}'), repeat('️'), repeat('\u{1F3F4}\u{E0067}'), `${'a'.repeat(SIZE)}\u007F`]) {
    expect(cpuMs(() => unsafeReason(text))).toBeLessThan(CPU_BUDGET_MS)
  }
})
