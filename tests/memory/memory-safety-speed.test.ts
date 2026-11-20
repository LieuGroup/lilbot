import { expect, test } from 'bun:test'
import { unsafeReason } from '../../server/memory/memory-safety'

const SIZE = 256 * 1024
const repeat = (unit: string) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE)

// One webhook body is scanned on the server's only thread: every rule must stay linear (it was 4.4 s for `-eyJ`).
test('every safety rule scans a 256 KiB adversarial text in well under a second', () => {
  for (const text of [
    repeat('-eyJ'),
    repeat('eyJ0eXAiOiJKV1QiLCJhbGciOi.'),
    repeat('sk-'),
    `token${' '.repeat(SIZE)}`,
    repeat('token '),
    repeat('ignore '),
    repeat('curl '),
    repeat('do not tell '),
    repeat('A-b_c9'),
    repeat('\\'),
    repeat('/hook/'),
    repeat('%2Fhook')
  ]) {
    const started = performance.now()
    unsafeReason(text)
    expect(performance.now() - started).toBeLessThan(100)
  }
})

test('the rewritten token rule still finds real tokens', () => {
  expect(unsafeReason('a JWT eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig')).toContain('access key or token')
  expect(unsafeReason('{"jwt":"eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig"}')).toContain('access key or token')
  expect(unsafeReason('a-word-eyJ-not-a-token')).toBeNull()
})
