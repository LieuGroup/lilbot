import { afterAll, expect, test } from 'bun:test'
import { delegationFixture, removeFixtureFolders } from '../threads/delegation-fixture'
import { deliveries, handedOver, joined } from './exchange-fixture'

afterAll(removeFixtureFolders)

test('dropping a parent drops its children with the same reason, stops each delegated exchange as Oscar, and tells the bots', async () => {
  const f = joined()
  const parent = await f.w.open('a')
  const { exchanges } = await f.d.delegation.delegate('a', {
    requestId: 'r',
    tasks: [
      { to: 'b', task: 'Long job for B' },
      { to: 'c', task: 'Long job for C' }
    ]
  })
  await f.d.settle()
  const runB = f.d.runs.find(r => r.botId === 'b')!
  f.w.state.chats.set('b', runB.chatId)
  await f.w.work.act('b', { requestId: 'b1', title: 'B’s job', kind: 'file', done: 'b.txt exists' })
  const tidy = await f.w.work.act('b', { requestId: 'b2', title: 'Tidy up', kind: 'file', done: 'no temp files' })
  expect(tidy.parentId).toBe(exchanges[0].exchangeId)

  const dropped = await f.board.drop(parent.id, 'Plan changed')
  expect(dropped.children.map(c => [c.status, c.ownerId])).toEqual([
    ['dropped', 'b'],
    ['dropped', 'c']
  ])
  for (const id of [exchanges[0].exchangeId, exchanges[1].exchangeId, tidy.id]) expect(f.w.work.view(id)).toMatchObject({ status: 'dropped', dropReason: 'Plan changed' })
  expect(f.w.work.view(tidy.id).events.at(-1)).toMatchObject({ by: 'oscar', kind: 'status', status: 'dropped' })
  for (const e of exchanges) expect(f.d.store.get(e.exchangeId)).toMatchObject({ status: 'cancelled', stoppedBy: { kind: 'oscar', name: 'Oscar' } })
  expect(f.d.stops).toEqual(f.d.runs.filter(r => r.botId !== 'a').map(r => r.chatId))
  const notices = deliveries(f, 'notice')
  expect(notices.map(n => [n.target, n.sourceChat])).toEqual([
    ['a', 'a-main'],
    ['a', 'a-main']
  ])
  expect(notices[0].text).toContain('Oscar stopped the task you handed to "B"')
  expect(notices[0].text).toContain('"Plan changed"')
  // The delegating bot is told in the work board’s own outbox; nothing is said in the sessions of the exchanges this drop stops.
  expect(f.w.database.query('SELECT bot_id, chat_id, status FROM work_answers ORDER BY rowid').all()).toEqual([{ bot_id: 'a', chat_id: null, status: 'stopping' }])
  // What the stopped turns still say is kept but never delivered.
  for (const r of f.d.runs.filter(r => r.botId !== 'a')) r.finish('Too late', [], 'stopped')
  await f.d.settle()
  await f.d.settle()
  expect(f.d.store.get(exchanges[0].exchangeId).messages.at(-1)).toMatchObject({ authorId: 'b', withheld: true })
  expect(f.d.store.get(exchanges[0].exchangeId).status).toBe('cancelled')
  expect(f.w.work.view(exchanges[0].exchangeId).dropReason).toBe('Plan changed')
})

test('dropping an item whose exchange has already answered tells the delegating bot without changing the exchange', async () => {
  const f = joined()
  const { id, run } = await handedOver(f)
  await f.w.work.act('b', { requestId: 'b2', itemId: id, status: 'needs_oscar', question: 'Which word?' })
  run.finish('Asked.')
  await f.d.settle()
  expect(f.d.store.get(id).status).toBe('finished')
  const dropped = await f.board.drop(id, 'Not needed')
  expect(dropped).toMatchObject({ status: 'dropped', dropReason: 'Not needed' })
  expect(f.d.stops).toEqual([])
  expect(f.d.store.get(id)).toMatchObject({ status: 'finished', stoppedBy: null })
  expect(f.w.database.query('SELECT count(*) AS n FROM work_answers').get()).toEqual({ n: 0 })
  expect(deliveries(f, 'notice').map(n => [n.id, n.target])).toEqual([[`dropped:${id}`, 'a']])
  expect(deliveries(f, 'notice')[0].text).toContain('"Not needed"')
})

test('a secondary item dropped on its own, while its exchange goes on, is told in the exchange’s session without ending the turn', async () => {
  const f = joined()
  const { id, run } = await handedOver(f)
  const tidy = await f.w.work.act('b', { requestId: 'b2', title: 'Tidy up', kind: 'file', done: 'no temp files' })
  await f.board.drop(tidy.id, 'Skip it')
  expect(f.d.store.get(id).status).toBe('working')
  expect(f.d.stops).toEqual([])
  expect(f.w.database.query('SELECT bot_id, chat_id, status FROM work_answers').all()).toEqual([{ bot_id: 'b', chat_id: run.chatId, status: 'pending' }])
})

test('a restart between the drop’s commit and the interrupt still ends the receiver’s turn, once, and nothing it says is delivered', async () => {
  const f = joined()
  const { id, run } = await handedOver(f)
  f.d.threads.dropped(id, 'Not wanted') // the process dies before the returned interrupt runs
  expect(f.d.stops).toEqual([])
  const restarted = delegationFixture({ database: f.w.database })
  await restarted.settle()
  await restarted.settle()
  expect(restarted.stops).toEqual([run.chatId])
  expect(f.d.store.get(id)).toMatchObject({ status: 'cancelled', stoppedBy: { kind: 'oscar' } })
  expect(restarted.runs.filter(r => r.botId === 'b')).toEqual([])
  expect(f.w.database.query("SELECT status FROM thread_deliveries WHERE threadId = ? AND kind = 'request'").all(id)).toEqual([{ status: 'done' }])
  expect(deliveries(f, 'answer')).toEqual([])
  const again = delegationFixture({ database: f.w.database })
  await again.settle()
  expect(again.stops).toEqual([])
})
