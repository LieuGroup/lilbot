import { expect, test } from 'bun:test'
import { WorkAnswers } from '../../server/work/work-answers'
import { workFixture } from './work-fixture'

const rows = (f: ReturnType<typeof workFixture>) => f.database.query('SELECT id, bot_id, chat_id, status FROM work_answers ORDER BY rowid').all()
async function flush(f: ReturnType<typeof workFixture>) {
  f.answers.tick()
  await Bun.sleep(5)
}

test('dropping an item its owner is working on ends that turn, then tells it in its main conversation, once', async () => {
  const f = workFixture()
  const item = await f.open('a')
  const dropped = await f.board.drop(item.id, 'Plan changed')
  expect(dropped).toMatchObject({ status: 'dropped', dropReason: 'Plan changed' })
  expect(f.delivered).toEqual([])
  await flush(f)
  expect(f.order).toEqual(['interrupt', 'deliver'])
  expect(f.interrupted).toEqual([{ botId: 'a', chatId: null }])
  expect(f.delivered).toEqual([{ botId: 'a', chatId: null, runId: `work-drop-${item.id}`, prompt: expect.stringContaining('"Plan changed"') }])
  expect(f.delivered[0].prompt).toContain(`work item ${item.id}`)
  expect(f.delivered[0].prompt).toContain('report nothing further')
  await flush(f)
  expect(f.delivered).toHaveLength(1)
  expect(rows(f)).toEqual([{ id: `drop-${item.id}`, bot_id: 'a', chat_id: null, status: 'done' }])
  // A restarted server finds it done: nothing is sent or interrupted again.
  const again = new WorkAnswers(
    f.database,
    async (...call) => void f.delivered.push({ botId: call[0], prompt: call[1], runId: call[2], chatId: call[3] }),
    async () => void f.interrupted.push({ botId: 'x', chatId: null })
  )
  again.tick()
  await Bun.sleep(5)
  expect([f.delivered.length, f.interrupted.length]).toEqual([1, 1])
})

test('a notice that must be retried ends the turn only once, and a restart before delivery still sends it exactly once', async () => {
  const f = workFixture()
  const item = await f.open('a')
  await f.board.drop(item.id, 'Not wanted')
  expect(rows(f)).toMatchObject([{ status: 'stopping' }])
  f.deliver.fail = new Error('engine down')
  await flush(f)
  expect(f.interrupted).toHaveLength(1)
  expect(rows(f)).toMatchObject([{ status: 'pending' }])
  f.deliver.fail = null
  const restarted = new WorkAnswers(
    f.database,
    async (botId, prompt, runId, chatId) => void f.delivered.push({ botId, prompt, runId, chatId }),
    async () => void f.interrupted.push({ botId: 'a', chatId: null })
  )
  restarted.tick()
  restarted.tick()
  await Bun.sleep(5)
  restarted.tick()
  expect(f.delivered).toHaveLength(1)
  expect(f.interrupted).toHaveLength(1)
})

test('an item that is open or waiting on Oscar is told without ending a turn; one from a routine run goes to that run’s session', async () => {
  const f = workFixture()
  const open = await f.open('a', { done: undefined, title: 'Not started' })
  expect(open.status).toBe('open')
  const asking = await f.open('b')
  await f.work.act('b', { requestId: 'ask', itemId: asking.id, status: 'needs_oscar', question: 'Which?' })
  await f.board.drop(open.id, 'No')
  await f.board.drop(asking.id, 'No')
  expect(f.state.waits.map(w => [w.itemId, w.on])).toEqual([
    [asking.id, true],
    [asking.id, false]
  ])
  await flush(f)
  expect(f.interrupted).toEqual([])
  expect(f.delivered.map(d => d.botId).sort()).toEqual(['a', 'b'])

  f.database.exec("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('c', 'C', '', '', 'test', 'native-c')")
  const routine = f.routineStore.create('c', { requestId: 'daily', description: 'Check sales', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'oscar' }, 0, 5)
  const [run] = f.routineStore.claimDue(Date.now() + 1_000_000)
  f.routineStore.attach(run.id, 'c-run-session', Date.now())
  f.state.chats.set('c', 'c-run-session')
  const fromRun = await f.work.act('c', { requestId: 'run', title: 'Sales check', kind: 'file', done: 'a number read', asked: 'self' })
  expect(routine.id).toBe(run.routineId)
  await f.board.drop(fromRun.id, 'Skip today')
  await flush(f)
  // It was working, so the run’s session is interrupted first; not the main conversation.
  expect(f.interrupted).toEqual([{ botId: 'c', chatId: 'c-run-session' }])
  expect(f.delivered.at(-1)).toMatchObject({ botId: 'c', chatId: 'c-run-session' })
})

test('dropping a deleted bot’s item leaves the drop saved and sends nothing', async () => {
  const f = workFixture()
  const item = await f.open('a')
  await f.board.drop(item.id, 'Gone')
  f.links.forgetBot('a')
  await flush(f)
  expect(f.delivered).toEqual([])
  expect(rows(f)).toMatchObject([{ status: 'dropped' }])
})
