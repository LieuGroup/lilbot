import { afterAll, expect, test } from 'bun:test'
import { LilBotError } from '../../shared/lilbot-error'
import { DelegateInput } from '../../shared/thread-schema'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

test('to: self is still refused while worker: true succeeds and forwards model and reasoningEffort', async () => {
  const checked: unknown[] = []
  const f = delegationFixture({
    validateModel: async model => {
      checked.push(model)
      if (model.model === 'bogus') throw new LilBotError('invalid_model', 'Unknown model.')
    }
  })
  await expect(f.delegation.delegate('a', { requestId: 'self', tasks: [{ to: 'a', task: 'Fix it' }] })).rejects.toMatchObject({ code: 'thread_self' })
  expect(DelegateInput.safeParse({ requestId: 'both', tasks: [{ to: 'b', worker: true, task: 'Fix it' }] }).success).toBe(false)
  expect(DelegateInput.safeParse({ requestId: 'non-worker-model', tasks: [{ to: 'b', model: { provider: 'p', model: 'm' }, task: 'Fix it' }] }).success).toBe(false)
  expect(DelegateInput.safeParse({ requestId: 'cont-model', tasks: [{ exchangeId: 'ex', worker: true, reasoningEffort: 'high', task: 'More' }] }).success).toBe(false)
  await expect(f.delegation.delegate('a', { requestId: 'bad-model', tasks: [{ worker: true, model: { provider: 'p', model: 'bogus' }, task: 'Fix it' }] })).rejects.toMatchObject({
    code: 'invalid_model'
  })
  expect(f.store.list('a')).toEqual([])

  const model = { provider: 'p', model: 'coder-1' }
  const out = await f.delegation.delegate('a', { requestId: 'ok', tasks: [{ worker: true, model, reasoningEffort: 'high', task: 'Refactor parser' }] })
  expect(checked).toContainEqual(model)
  expect(out.exchanges[0]).toMatchObject({ to: 'worker', worker: true, status: 'waiting' })
  await f.settle()
  expect(f.runs).toHaveLength(1)
  expect(f.runs[0].botId).toBe('a')
  expect(f.runs[0].options.model).toEqual(model)
  expect(f.runs[0].options.reasoningEffort).toBe('high')
  expect(f.runs[0].prompt).toContain(`code work item for this worker: ${out.exchanges[0].exchangeId}`)
  expect(f.runs[0].prompt).toContain('Do not spawn another worker, delegate work, or start a group')
  expect(f.runs[0].prompt).not.toContain('You may hand work on with lilbot_delegate')
})

test('multiple workers can start in one batch up to workersPerBot (3) and a fourth is refused', async () => {
  const f = delegationFixture()
  const batch = await f.delegation.delegate('a', {
    requestId: 'three',
    tasks: [
      { worker: true, task: 'Task 1' },
      { worker: true, task: 'Task 2' },
      { worker: true, task: 'Task 3' }
    ]
  })
  expect(batch.exchanges).toHaveLength(3)
  expect(f.store.openWorkers('a')).toBe(3)
  await expect(f.delegation.delegate('a', { requestId: 'fourth', tasks: [{ worker: true, task: 'Task 4' }] })).rejects.toMatchObject({ code: 'thread_limit' })
  // An ordinary delegation still fits inside openPerBot (8).
  const other = await f.delegation.delegate('a', { requestId: 'to-b', tasks: [{ to: 'b', task: 'Review' }] })
  expect(other.exchanges).toHaveLength(1)
})

test('a worker session and its compressed continuation cannot start another worker, delegation or group', async () => {
  const roots = new Map<string, string | null>()
  const f = delegationFixture({ rootOf: (_bot, chat) => (roots.has(chat) ? roots.get(chat)! : chat) })
  await f.delegation.delegate('a', { requestId: 'w1', tasks: [{ worker: true, task: 'Code feature' }] })
  await f.settle()
  const workerChat = f.runs[0].chatId

  for (const session of [workerChat, 'compressed-worker-child']) {
    if (session !== workerChat) roots.set(session, workerChat)
    f.group.chats.set('a', session)
    await expect(f.delegation.delegate('a', { requestId: `nw-${session}`, tasks: [{ worker: true, task: 'Sub-worker' }] })).rejects.toMatchObject({
      code: 'thread_worker_nested'
    })
    await expect(f.delegation.delegate('a', { requestId: `nd-${session}`, tasks: [{ to: 'b', task: 'Ask B' }] })).rejects.toMatchObject({
      code: 'thread_worker_nested'
    })
    await expect(f.groups.act('a', { action: 'start', requestId: `ng-${session}`, purpose: 'Discuss', members: ['b', 'c'], text: 'Thoughts?' })).rejects.toMatchObject({
      code: 'thread_worker_nested'
    })
  }

  roots.set('unreadable-chat', null)
  f.group.chats.set('a', 'unreadable-chat')
  await expect(f.delegation.delegate('a', { requestId: 'unreadable', tasks: [{ worker: true, task: 'Should fail closed' }] })).rejects.toMatchObject({
    code: 'session_unknown'
  })
})

test('verbose worker replies over 20,000 characters clamp cleanly with a transcript pointer instead of failing', async () => {
  const f = delegationFixture()
  const [ex1, ex2] = (
    await f.delegation.delegate('a', {
      requestId: 'chatty',
      tasks: [
        { worker: true, task: 'Long multi-step run' },
        { worker: true, task: 'Huge final summary' }
      ]
    })
  ).exchanges.map(e => e.exchangeId)
  await f.settle()

  // Multi-step narration totals >20k while final summary fits.
  f.runs[0].finish('Final PR #42 ready.', [{ kind: 'assistant', text: 'step '.repeat(5000) }])
  // Single final assistant message itself exceeds 20k.
  f.runs[1].finish('y'.repeat(25_000))
  await f.settle()
  await f.settle()

  const t1 = await f.threads.open('a', ex1)
  const t2 = await f.threads.open('a', ex2)
  expect(t1.status).toBe('finished')
  expect(t2.status).toBe('finished')
  const answers = f.runs.slice(2)
  expect(answers).toHaveLength(2)
  expect(answers[0].prompt).toContain('Final PR #42 ready.')
  expect(answers[0].prompt).toContain(`[truncated; full transcript in exchange ${ex1}]`)
  expect(answers[1].prompt).toContain(`[truncated; full transcript in exchange ${ex2}]`)
  // Full untruncated transcript stays in the stored thread.
  expect((t2.messages.at(-1)!.items[0] as { text: string }).text.length).toBe(25_000)
})

test('concurrentWorkers caps running workers at 4 while non-worker delegations, answers and notices are never starved', async () => {
  const f = delegationFixture()
  // Start 5 workers across two bots (a: 3, b: 2).
  await f.delegation.delegate('a', {
    requestId: 'aw',
    tasks: [
      { worker: true, task: 'A1' },
      { worker: true, task: 'A2' },
      { worker: true, task: 'A3' }
    ]
  })
  const bWorkers = await f.delegation.delegate('b', {
    requestId: 'bw',
    tasks: [
      { worker: true, task: 'B1' },
      { worker: true, task: 'B2' }
    ]
  })
  // Plus a non-worker delegation from c to d.
  await f.delegation.delegate('c', { requestId: 'cd', tasks: [{ to: 'd', task: 'Regular task' }] })
  await f.settle()

  // 4 workers + 1 ordinary delegation started; 5th worker (B2) waits on concurrentWorkers.
  expect(f.runs).toHaveLength(5)
  expect(f.runs.filter(r => r.botId === 'b')).toHaveLength(1)
  expect(f.store.get(bWorkers.exchanges[1].exchangeId).status).toBe('waiting')

  // Fill the 6th work slot with another ordinary delegation (d -> c), plus a 3rd delegation that waits.
  await f.delegation.delegate('d', { requestId: 'dc', tasks: [{ to: 'c', task: 'Another task' }] })
  const waitingDel = await f.delegation.delegate('b', { requestId: 'bc', tasks: [{ to: 'c', task: 'Queued delegation' }] })
  const extraDel = await f.delegation.delegate('c', { requestId: 'cb', tasks: [{ to: 'b', task: 'Also queued' }] })
  await f.settle()
  expect(f.runs).toHaveLength(6)
  expect(f.store.get(waitingDel.exchanges[0].exchangeId).status).toBe('waiting')

  // Finish one worker (queueing its answer) and cancel one waiting delegation as Oscar (queueing a notice).
  // On the next tick, B2 fills the 4th worker slot (6/6 work slots occupied), yet both the answer and notice still start.
  f.runs[0].finish('Answer while slots full')
  await f.threads.cancel(waitingDel.exchanges[0].exchangeId, { kind: 'oscar', id: null, name: 'Oscar' })
  await f.settle()
  await f.settle()
  expect(f.store.get(bWorkers.exchanges[1].exchangeId).status).toBe('working')
  expect(f.store.get(extraDel.exchanges[0].exchangeId).status).toBe('waiting')
  expect(f.runs.some(r => r.prompt.includes('Answer while slots full'))).toBe(true)
  expect(f.runs.some(r => r.prompt.includes('Oscar stopped'))).toBe(true)
})
