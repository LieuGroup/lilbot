import { expect, test } from 'bun:test'
import { addBot, systemFixture } from './system-fixture'

test('a bot runs its board through its own key: open, refused done, evidence and done in one call, logged against the item', async () => {
  const f = systemFixture()
  const opened = await f.call('b1', 'lilbot_work', { requestId: 'r1', title: 'Write hello.txt', kind: 'file', done: 'hello.txt in my folder says hi', botId: 'someone-else' })
  const item = opened.data
  expect(item).toMatchObject({ ownerId: 'b1', status: 'working', askedBy: { kind: 'oscar' }, origin: { kind: 'conversation', id: 'b1-main' } })
  const refused = await f.call('b1', 'lilbot_work', { requestId: 'r2', itemId: item.id, status: 'done', result: 'Written' })
  expect(refused.error).toContain('evidence of the real result')
  const done = await f.call('b1', 'lilbot_work', {
    requestId: 'r3',
    itemId: item.id,
    status: 'done',
    result: 'Written',
    evidence: [{ proves: 'the file says hi', command: 'cat hello.txt', output: 'hi' }]
  })
  expect(done.data).toMatchObject({ status: 'done', evidenceCount: 1 })
  const log = f.changes.recent(5).filter(change => change.tool === 'lilbot_work')
  expect(log.map(change => change.target)).toEqual([item.id, item.id])
  expect(log[0].fields).toContain('evidence')
  const other = await addBot(f, 'Other')
  expect((await f.call(other.id, 'lilbot_work', { requestId: 'x', itemId: item.id, status: 'dropped', reason: 'mine' })).error).toContain('Only the bot that owns')
  const mine = (await f.call(other.id, 'lilbot_work_list')).data.items
  const all = (await f.call(other.id, 'lilbot_work_list', { mine: false })).data.items
  expect([mine.length, all.map((i: { id: string }) => i.id)]).toEqual([0, [item.id]])
  expect((await f.call(other.id, 'lilbot_work_list', { itemId: item.id })).data.evidence).toHaveLength(1)
})

test('lilbot_delegate with an itemId hangs the handed-out task under it as the other bot’s item', async () => {
  const f = systemFixture()
  const other = await addBot(f, 'Helper')
  const parent = (await f.call('b1', 'lilbot_work', { requestId: 'p', title: 'Ship the report', kind: 'file', done: 'report.md checked by Helper' })).data
  const handed = (await f.call('b1', 'lilbot_delegate', { requestId: 'd', itemId: parent.id, tasks: [{ to: 'Helper', task: 'Check report.md' }] })).data
  expect(handed.itemId).toBe(parent.id)
  const child = (await f.call('b1', 'lilbot_work_list', { itemId: parent.id })).data.children[0]
  expect(child).toMatchObject({ id: handed.exchanges[0].exchangeId, ownerId: other.id, parentId: parent.id, askedBy: { kind: 'bot', id: 'b1' } })
})
