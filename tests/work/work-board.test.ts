import { expect, test } from 'bun:test'
import { workFixture } from './work-fixture'

const proof = { proves: 'it is there', url: 'https://example.com/report' }

test('the board filters by bot, status and time, newest change first', async () => {
  let now = 1_000
  const f = workFixture()
  Object.assign(f.work, { now: () => now })
  const first = await f.open('a')
  now = 2_000
  const second = await f.open('b')
  now = 3_000
  await f.work.act('a', { requestId: 'fin', itemId: first.id, status: 'done', result: 'Written', evidence: [proof] })
  expect(f.board.list({ limit: 100 }).map(i => i.id)).toEqual([first.id, second.id])
  expect(f.board.list({ botId: 'b', limit: 100 }).map(i => i.id)).toEqual([second.id])
  expect(f.board.list({ status: ['working'], limit: 100 }).map(i => i.id)).toEqual([second.id])
  expect(f.board.list({ from: 2_500, limit: 100 }).map(i => i.id)).toEqual([first.id])
  expect(f.board.list({ to: 2_500, limit: 100 }).map(i => i.id)).toEqual([second.id])
  expect(f.board.list({ limit: 1 })).toHaveLength(1)
  expect(f.board.open(first.id)).toMatchObject({ status: 'done', evidenceCount: 1, evidence: [{ proves: 'it is there' }] })
})

test('Oscar drops an item with a reason, and the bot can report on it no more', async () => {
  const f = workFixture()
  const item = await f.open('a')
  const pushes = f.state.pushes
  const dropped = f.board.drop(item.id, 'Not needed any more')
  expect(dropped).toMatchObject({ status: 'dropped', dropReason: 'Not needed any more' })
  expect(dropped.events.at(-1)).toMatchObject({ by: 'oscar', status: 'dropped' })
  expect(f.state.pushes).toBe(pushes + 1)
  await expect(f.work.act('a', { requestId: 'late', itemId: item.id, status: 'working' })).rejects.toThrow('dropped')
  expect(() => f.board.drop(item.id, 'Again')).toThrow('dropped')
})

test('Oscar answers the one question: saved, the item goes back to work, and the bot gets it in its main conversation once', async () => {
  const f = workFixture()
  const item = await f.open('a')
  expect(() => f.board.answer(item.id, 'Too early')).toThrow('not waiting')
  await f.work.act('a', { requestId: 'ask', itemId: item.id, status: 'needs_oscar', question: 'January or July first?' })
  const answered = f.board.answer(item.id, 'July first')
  expect(answered).toMatchObject({ status: 'working', question: null })
  expect(answered.events.slice(-2).map(e => [e.by, e.kind, e.text])).toEqual([
    ['oscar', 'answered', 'July first'],
    ['oscar', 'status', null]
  ])
  expect(f.state.waits.map(w => w.on)).toEqual([true, false])
  f.deliver.fail = new Error('engine down')
  f.answers.tick()
  await Bun.sleep(5)
  expect(f.delivered).toEqual([])
  f.deliver.fail = null
  Object.assign(f.answers, { retryAt: new Map() })
  f.answers.tick()
  f.answers.tick() // still on its way: not sent twice
  await Bun.sleep(5)
  f.answers.tick()
  expect(f.delivered).toHaveLength(1)
  expect(f.delivered[0]).toMatchObject({ botId: 'a', chatId: null })
  expect(f.delivered[0].prompt).toContain('July first')
  expect(f.delivered[0].prompt).toContain(item.id)
  expect(f.delivered[0].runId).toStartWith('work-answer-')
})

test('an item asked about before it started goes back to open, and an answer to an exchange’s item returns to that session', async () => {
  const f = workFixture()
  const bare = await f.work.act('a', { requestId: 'q', title: 'Plan the trip', status: 'needs_oscar', question: 'Which city?' })
  expect(f.board.answer(bare.id, 'Hanoi').status).toBe('open')
  f.database.query("UPDATE work_items SET origin_kind = 'exchange', status = 'needs_oscar', chat_id = 'a-hidden' WHERE id = ?").run(bare.id)
  f.board.answer(bare.id, 'Da Nang')
  f.answers.tick()
  await Bun.sleep(5)
  expect(f.delivered.map(d => d.chatId)).toEqual([null, 'a-hidden'])
})

test('the daily brief: what needs Oscar, what failed and what was done since then', async () => {
  let now = 10_000
  const f = workFixture()
  Object.assign(f.work, { now: () => now })
  const old = await f.open('a', { title: 'Old' })
  await f.work.act('a', { requestId: 'o', itemId: old.id, status: 'done', result: 'Done long ago', evidence: [proof] })
  now = 100_000
  const done = await f.open('a', { title: 'Done today' })
  await f.work.act('a', { requestId: 'd', itemId: done.id, status: 'done', result: 'Done', evidence: [proof] })
  const failed = await f.open('b', { title: 'Failed today' })
  await f.work.act('b', { requestId: 'f', itemId: failed.id, status: 'failed', result: 'The site was down' })
  const asking = await f.open('c', { title: 'Asking' })
  await f.work.act('c', { requestId: 'q', itemId: asking.id, status: 'needs_oscar', question: 'Go ahead?' })
  const brief = f.board.brief(50_000)
  expect(brief.needsOscar.map(i => [i.id, i.question])).toEqual([[asking.id, 'Go ahead?']])
  expect(brief.failed.map(i => i.id)).toEqual([failed.id])
  expect(brief.done).toEqual({ count: 1, items: [expect.objectContaining({ id: done.id })] })
})
