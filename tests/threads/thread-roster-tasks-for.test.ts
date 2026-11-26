import { afterAll, expect, test } from 'bun:test'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

const runOf = (f: ReturnType<typeof delegationFixture>, threadId: string) => {
  const run = f.runs.find(r => !r.finished && f.store.list('b').some(t => t.id === threadId && r.prompt.includes(t.id)))
  if (!run) throw new Error(`no run for ${threadId}`)
  return run
}

test('two running tasks from one bot both show; workingFor stays the oldest, not the last one started', async () => {
  const f = delegationFixture()
  const first = (await f.delegation.delegate('a', { requestId: 'r1', tasks: [{ to: 'b', task: 'First task' }] })).exchanges[0].exchangeId
  await f.settle()
  const second = (await f.delegation.delegate('a', { requestId: 'r2', tasks: [{ to: 'b', task: 'Second task' }] })).exchanges[0].exchangeId
  await f.settle()
  const entry = f.threads.roster().get('b')
  expect(entry?.tasksFor).toEqual([
    { threadId: first, botId: 'a', name: 'A' },
    { threadId: second, botId: 'a', name: 'A' }
  ])
  expect(entry?.workingFor).toEqual({ threadId: first, name: 'A' })
  expect(f.threads.roster().get('a')).toBeUndefined()

  runOf(f, first).finish('Done')
  await f.settle()
  expect(f.threads.roster().get('b')?.tasksFor).toEqual([{ threadId: second, botId: 'a', name: 'A' }])
  expect(f.threads.roster().get('b')?.workingFor).toEqual({ threadId: second, name: 'A' })

  runOf(f, second).finish('Done')
  await f.settle()
  expect(f.threads.roster().get('b')).toBeUndefined()
})

test('tasks from two bots each name their own sender', async () => {
  const f = delegationFixture()
  const fromA = (await f.delegation.delegate('a', { requestId: 'r1', tasks: [{ to: 'b', task: 'For A' }] })).exchanges[0].exchangeId
  await f.settle()
  const fromC = (await f.delegation.delegate('c', { requestId: 'r2', tasks: [{ to: 'b', task: 'For C' }] })).exchanges[0].exchangeId
  await f.settle()
  const entry = f.threads.roster().get('b')
  expect(entry?.tasksFor).toEqual([
    { threadId: fromA, botId: 'a', name: 'A' },
    { threadId: fromC, botId: 'c', name: 'C' }
  ])
  expect(entry?.workingFor).toEqual({ threadId: fromA, name: 'A' })
})

test('a stopped task leaves the list at once', async () => {
  const f = delegationFixture()
  const one = (await f.delegation.delegate('a', { requestId: 'r1', tasks: [{ to: 'b', task: 'One' }] })).exchanges[0].exchangeId
  await f.settle()
  const two = (await f.delegation.delegate('a', { requestId: 'r2', tasks: [{ to: 'b', task: 'Two' }] })).exchanges[0].exchangeId
  await f.settle()
  await f.delegation.cancel('a', one)
  expect(f.threads.roster().get('b')?.tasksFor).toEqual([{ threadId: two, botId: 'a', name: 'A' }])
})
