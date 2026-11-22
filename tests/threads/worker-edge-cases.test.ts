import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { THREAD_LIMITS } from '../../server/threads/thread-limits'
import { replyText } from '../../server/threads/thread-prompts'
import { DelegateInput } from '../../shared/thread-schema'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

test('continuing settled workers enforces workersPerBot and openPerBot, and to + exchangeId is rejected', async () => {
  expect(DelegateInput.safeParse({ requestId: 'bad', tasks: [{ to: 'b', exchangeId: 'ex-1', task: 'More' }] }).success).toBe(false)

  const f = delegationFixture()
  // Start and finish 3 workers (W1–W3).
  const first = await f.delegation.delegate('a', {
    requestId: 'w1-3',
    tasks: [
      { worker: true, task: 'W1' },
      { worker: true, task: 'W2' },
      { worker: true, task: 'W3' }
    ]
  })
  await f.settle()
  for (const r of f.runs) r.finish('done')
  await f.settle()
  for (const r of f.runs.filter(r => !r.finished)) r.finish('ack')
  await f.settle()
  expect(f.store.openWorkers('a')).toBe(0)

  // Start 3 new active workers (W4–W6), reaching workersPerBot = 3.
  await f.delegation.delegate('a', {
    requestId: 'w4-6',
    tasks: [
      { worker: true, task: 'W4' },
      { worker: true, task: 'W5' },
      { worker: true, task: 'W6' }
    ]
  })
  expect(f.store.openWorkers('a')).toBe(3)

  // Continuing settled W1–W3 (even without worker: true) must be refused by workersPerBot.
  await expect(f.delegation.delegate('a', { requestId: 'cont-all', tasks: first.exchanges.map(e => ({ exchangeId: e.exchangeId, task: 'Again' })) })).rejects.toMatchObject({
    code: 'thread_limit'
  })
  await expect(f.delegation.delegate('a', { requestId: 'cont-one', tasks: [{ exchangeId: first.exchanges[0].exchangeId, task: 'Again' }] })).rejects.toMatchObject({
    code: 'thread_limit'
  })
  expect(f.store.openWorkers('a')).toBe(3)

  // Fill remaining 5 ordinary slots (total open = 8) across finished + new exchanges, then verify continuing a settled exchange hits openPerBot.
  const ord = await f.delegation.delegate('a', { requestId: 'ord-done', tasks: [{ to: 'b', task: 'One' }] })
  await f.settle()
  f.runs.find(r => r.botId === 'b')!.finish('ORD_DONE')
  await f.settle()
  await f.settle()
  f.runs.find(r => r.prompt.includes('ORD_DONE'))!.finish('ack')
  await f.settle()
  // Open 5 ordinary delegations to bring open('a') to 3 workers + 5 ordinary = 8.
  for (let i = 0; i < 5; i++) {
    const t = ['b', 'c', 'd'][i % 3]
    await f.delegation.delegate('a', { requestId: `fill-${i}`, tasks: [{ to: t, task: `Fill ${i}` }] })
  }
  expect(f.store.open('a')).toBe(THREAD_LIMITS.openPerBot)
  await expect(f.delegation.delegate('a', { requestId: 'cont-ord', tasks: [{ exchangeId: ord.exchanges[0].exchangeId, task: 'Reopen' }] })).rejects.toMatchObject({
    code: 'thread_limit'
  })
})

test('answer and notice run in their own lane and are not starved behind pending oscar/redirect work on the same exchange', async () => {
  const f = delegationFixture()
  // Start 4 workers (filling concurrentWorkers = 4) and 1 more waiting worker.
  const aBatch = await f.delegation.delegate('a', {
    requestId: 'aw',
    tasks: [
      { worker: true, task: 'W1' },
      { worker: true, task: 'W2' },
      { worker: true, task: 'W3' }
    ]
  })
  await f.delegation.delegate('b', {
    requestId: 'bw',
    tasks: [
      { worker: true, task: 'W4' },
      { worker: true, task: 'W5' }
    ]
  })
  await f.settle()
  expect(f.runs).toHaveLength(4)

  // Queue an Oscar answer on W1 BEFORE W1 finishes (giving oscar a lower rowid than W1's upcoming answer).
  const w1Id = aBatch.exchanges[0].exchangeId
  f.threads.oscarAnswer(w1Id, 'oscar-1', 'Yes, proceed.')
  // W1 finishes its turn -> queues its answer (higher rowid than oscar-1), and frees the 4th worker slot which W5 grabs!
  f.runs[0].finish('Worker 1 reply before oscar turn')
  await f.settle()
  await f.settle()

  // W5 took the 4th worker slot (4 workers running, oscar-1 waits), yet W1's answer still started immediately!
  expect(f.runs.some(r => r.prompt.includes('Worker 1 reply before oscar turn'))).toBe(true)
  const oscarRow = f.store.delivery(`a:oscar-1`)!
  expect(oscarRow.status).toBe('pending')

  // Finish W1's answer (still leaving oscar-1 pending and all 4 worker slots full), then verify a notice on W1 also starts in the reply lane.
  f.runs.find(r => r.prompt.includes('Worker 1 reply before oscar turn'))!.finish('ack')
  f.store.enqueue('notice-behind-oscar', w1Id, 'a', 'a', 'a-main', 'LilBot (not Oscar, not another bot): Notice unstarved', 'notice')
  await f.settle()
  await f.settle()
  expect(f.runs.some(r => r.prompt.includes('Notice unstarved'))).toBe(true)
})

test('racing concurrent delegate() batches commit all-or-nothing, fire changed(), and clean up refused file copies', async () => {
  let changed = 0
  const f = delegationFixture({ changed: () => changed++ })
  mkdirSync(join(f.root, 'a'), { recursive: true })
  writeFileSync(f.path('a', 'spec.txt'), 'brief')

  // Start 1 worker so 2 slots remain under workersPerBot = 3.
  await f.delegation.delegate('a', { requestId: 'w0', tasks: [{ worker: true, task: 'W0' }] })
  const before = changed

  // Race two 2-worker batches with files; exactly one batch must win completely and the other must commit 0 tasks.
  const [r1, r2] = await Promise.allSettled([
    f.delegation.delegate('a', {
      requestId: 'race-1',
      tasks: [
        { worker: true, task: 'R1-a', files: ['spec.txt'] },
        { worker: true, task: 'R1-b', files: ['spec.txt'] }
      ]
    }),
    f.delegation.delegate('a', {
      requestId: 'race-2',
      tasks: [
        { worker: true, task: 'R2-a', files: ['spec.txt'] },
        { worker: true, task: 'R2-b', files: ['spec.txt'] }
      ]
    })
  ])

  const fulfilled = [r1, r2].filter(r => r.status === 'fulfilled')
  const rejected = [r1, r2].filter(r => r.status === 'rejected')
  expect(fulfilled).toHaveLength(1)
  expect(rejected).toHaveLength(1)
  expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'thread_limit' })
  expect(f.store.openWorkers('a')).toBe(3)
  expect(f.store.list('a')).toHaveLength(3)
  expect(changed).toBe(before + 1)

  // Refused batch left no leaked file copies in exchanges/.
  const exDir = join(f.root, 'a', 'exchanges')
  const copiedFiles = readdirSync(exDir).flatMap(dir => readdirSync(join(exDir, dir)))
  expect(copiedFiles).toHaveLength(2)
})

test('replyText skips blank trailing items, preserves UTF-16 surrogate pairs, and closes unclosed code fences', () => {
  const clamp = { exchangeId: 'ex-123', hard: true }

  // 1. Whitespace-only trailing item does not mask the real answer.
  const withBlank = replyText(
    [
      { kind: 'assistant', text: 'step '.repeat(5000) },
      { kind: 'assistant', text: 'Real final answer.' },
      { kind: 'assistant', text: '   \n\t  ' }
    ],
    clamp
  )
  expect(withBlank).toContain('Real final answer.')
  expect(withBlank).toContain('[truncated; full transcript in exchange ex-123]')

  // 2. Non-BMP emoji right on the UTF-16 cut boundary is never split into a lone surrogate.
  const note = `\n\n[truncated; full transcript in exchange ${clamp.exchangeId}]`
  const budget = THREAD_LIMITS.text - note.length
  const emojiAtBoundary = `${'a'.repeat(budget - 1)}🚀${'b'.repeat(500)}`
  const cutEmoji = replyText([{ kind: 'assistant', text: emojiAtBoundary }], clamp)
  expect(cutEmoji.length).toBeLessThanOrEqual(THREAD_LIMITS.text)
  expect(Buffer.from(cutEmoji, 'utf8').toString('utf8')).toBe(cutEmoji)

  // 3. Truncating inside an open Markdown code block closes the fence before the note and stays within limit.
  const openFence = `Summary:\n\`\`\`ts\n${'const x = 1;\n'.repeat(2000)}\`\`\``
  const cutFence = replyText([{ kind: 'assistant', text: openFence }], clamp)
  expect(cutFence.length).toBeLessThanOrEqual(THREAD_LIMITS.text)
  expect((cutFence.match(/```/g)?.length ?? 0) % 2).toBe(0)
  expect(Buffer.from(cutFence, 'utf8').toString('utf8')).toBe(cutFence)
  expect(cutFence).toEndWith(note)
})
