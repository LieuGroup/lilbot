/** Linear-time speed tests for preview formatting and sanitization on 256 KiB adversarial inputs. */
import { expect, test } from 'bun:test'
import { previewFromItem } from '../../server/history/history-preview'
import { bestCpuMs, scalingRatio } from '../helpers/cpu-time'

const SMALL = 64 * 1024
const SIZE = 256 * 1024
const repeat = (unit: string, size: number) => unit.repeat(Math.ceil(size / unit.length)).slice(0, size)

// Every preview scan runs synchronously on the server's only thread (on live events and cold roster seed).
// Both the 100 ms thread-CPU budget at 256 KiB and the <9x scaling bound from 64 KiB catch quadratic regressions.
const CPU_BUDGET_MS = 100
const MAX_LINEAR_RATIO = 9

function expectLinearPreview(make: (size: number) => string) {
  const large = make(SIZE)
  const largeMs = bestCpuMs(() => previewFromItem({ kind: 'assistant', text: large }, 1000), CPU_BUDGET_MS)
  expect(largeMs).toBeLessThan(CPU_BUDGET_MS)
  const small = make(SMALL)
  const ratio = scalingRatio(
    () => previewFromItem({ kind: 'assistant', text: small }, 1000),
    () => previewFromItem({ kind: 'assistant', text: large }, 1000),
    largeMs
  )
  if (ratio !== null) expect(ratio).toBeLessThan(MAX_LINEAR_RATIO)
}

test('preview formatting stays strictly linear on 256 KiB adversarial inputs', () => {
  const shapes: ((size: number) => string)[] = [
    n => 'a'.repeat(n),
    n => `${'a'.repeat(n - 11)}attachments`,
    n => repeat('/attachments/file.png ', n),
    n => `${' '.repeat(n)}X`,
    n => `${'-'.repeat(n)}X`,
    n => `${repeat('| - ', n)}X`,
    n => repeat('://a:b', n),
    n => `://a:${'b'.repeat(n)}`,
    n => repeat('[a](', n),
    n => repeat('![', n),
    n => repeat('**a*', n),
    n => repeat('_a', n),
    n => `${repeat('> ', n)}X`,
    n => repeat('`a', n),
    n => repeat('[LilBot notice, not from Oscar: a run of your webhook ', n)
  ]
  for (const make of shapes) expectLinearPreview(make)
})
