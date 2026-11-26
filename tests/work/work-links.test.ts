import { afterAll, expect, test } from 'bun:test'
import { delegationFixture, removeFixtureFolders } from '../threads/delegation-fixture'
import { workFixture } from './work-fixture'

afterAll(removeFixtureFolders)

const proof = { proves: 'hello.txt says hi', command: 'cat hello.txt', output: 'hi' }

function joined() {
  const w = workFixture()
  const d = delegationFixture({
    database: w.database,
    work: w.links,
    changed: () => w.links.settleExchanges(id => d.store.get(id).stoppedBy?.name ?? null)
  })
  return { w, d }
}

test('work handed out inside an item becomes each receiver’s child item, linked through the exchange’s parent', async () => {
  const { w, d } = joined()
  const parent = await w.open('a')
  const handed = await d.delegation.delegate('a', {
    requestId: 'r',
    tasks: [
      { to: 'b', task: 'Write hello.txt\nwith hi in it' },
      { to: 'c', task: 'Check the sums' }
    ]
  })
  expect(handed.itemId).toBe(parent.id)
  const [toB, toC] = handed.exchanges.map(e => e.exchangeId)
  expect((await d.threads.open('a', toB)).parentId).toBe(parent.id)
  const children = w.work.view(parent.id).children
  expect(children.map(c => [c.id, c.ownerId, c.status, c.title])).toEqual([
    [toB, 'b', 'open', 'Write hello.txt'],
    [toC, 'c', 'open', 'Check the sums']
  ])
  expect(children[0]).toMatchObject({ parentId: parent.id, askedBy: { kind: 'bot', id: 'a', name: 'A' }, origin: { kind: 'exchange', id: toB } })

  await d.settle()
  const run = d.runs.find(r => r.botId === 'b')!
  expect(run.prompt).toContain(`your work item ${toB}`)
  // The receiver opens from its exchange session: that is the item LilBot opened for it.
  w.state.chats.set('b', run.chatId)
  const opened = await w.work.act('b', { requestId: 'b1', title: 'Hello file', kind: 'file', done: 'hello.txt in my folder says hi' })
  expect(opened).toMatchObject({ id: toB, status: 'working', title: 'Hello file' })
  await w.work.act('b', { requestId: 'b2', itemId: toB, status: 'done', result: 'Written', evidence: [proof] })
  expect(w.work.view(parent.id).children.map(c => c.status)).toEqual(['done', 'open'])
  // More work in the same exchange is a new item under the exchange's own.
  const more = await w.work.act('b', { requestId: 'b3', title: 'Tidy up', kind: 'file', done: 'no temp files' })
  expect(more).toMatchObject({ parentId: toB, origin: { kind: 'exchange', id: toB }, askedBy: { kind: 'bot', id: 'a' } })
})

test('the parent is the named item, else the only unfinished one in that conversation; never another bot’s item', async () => {
  const { w, d } = joined()
  const first = await w.open('a')
  await w.open('a', { title: 'Second' })
  const none = await d.delegation.delegate('a', { requestId: 'r1', tasks: [{ to: 'b', task: 'Two open: no guess' }] })
  expect(none.itemId).toBeUndefined()
  expect((await d.threads.open('a', none.exchanges[0].exchangeId)).parentId).toBeNull()
  expect(w.work.view(first.id).children).toEqual([])
  const named = await d.delegation.delegate('a', { requestId: 'r2', itemId: first.id, tasks: [{ to: 'c', task: 'Under the first' }] })
  expect(w.work.view(first.id).children.map(c => c.id)).toEqual([named.exchanges[0].exchangeId])
  const theirs = await w.open('b')
  await expect(d.delegation.delegate('a', { requestId: 'r3', itemId: theirs.id, tasks: [{ to: 'c', task: 'x' }] })).rejects.toThrow('your own items')
  expect(d.store.delivery('a:r3:0')).toBeNull()
})

test('stopping an exchange drops its child item, saying who stopped it; a deleted bot’s unfinished items are dropped', async () => {
  const { w, d } = joined()
  const parent = await w.open('a')
  const { exchanges } = await d.delegation.delegate('a', { requestId: 'r', tasks: [{ to: 'b', task: 'Long job' }] })
  await d.settle()
  await d.delegation.cancel('a', exchanges[0].exchangeId)
  expect(w.work.view(exchanges[0].exchangeId)).toMatchObject({ status: 'dropped', dropReason: 'The exchange was stopped by A.' })
  w.links.forgetBot('a')
  const kept = w.work.view(parent.id)
  expect(kept).toMatchObject({ status: 'dropped', dropReason: 'The bot was deleted.', ownerName: 'A' })
  expect(kept.events.at(-1)).toMatchObject({ by: 'lilbot', kind: 'status', status: 'dropped' })
})

test('a routine run opens items as the routine, and links an item it reports on', async () => {
  const w = workFixture()
  w.database.exec("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('a', 'A', '', '', 'test', 'native-a')")
  const routine = w.routineStore.create(
    'a',
    { requestId: 'daily', description: 'Check the sales dashboard', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'oscar' },
    0,
    5
  )
  const [run] = w.routineStore.claimDue(Date.now() + 1_000_000)
  w.routineStore.attach(run.id, 'a-routine-session', Date.now())
  const earlier = await w.open('a')
  w.state.chats.set('a', 'a-routine-session')
  const item = await w.work.act('a', { requestId: 'run-1', title: 'Sales check', kind: 'file', done: 'today’s figure read from the dashboard', asked: 'self' })
  expect(item.origin).toEqual({ kind: 'routine_run', id: run.id })
  expect(item.askedBy).toEqual({ kind: 'routine', id: routine.id, name: 'Check the sales dashboard' })
  expect(w.state.lines.map(line => line.id)).toEqual([earlier.id])
  const linked = await w.work.act('a', { requestId: 'run-2', itemId: earlier.id, evidence: [proof] })
  expect(linked.links).toEqual([{ kind: 'routine_run', id: run.id }])
})

test('a webhook run opens items as the webhook, with the run as their origin', async () => {
  const w = workFixture()
  w.database.exec("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('a', 'A', '', '', 'test', 'native-a')")
  const hook = w.webhookStore.create('a', { requestId: 'gh', description: 'Triage new issues', source: 'GitHub', createdBy: 'oscar' }, null, 0)
  w.webhookStore.events.add(hook.id, { deliveryId: null, bodyHash: null }, { item: '{}', size: 2, refusal: null }, 0)
  const [run] = w.webhookStore.claimDue(60_000)
  w.webhookStore.attach(run.id, 'a-webhook-session', 60_000)
  w.state.chats.set('a', 'a-webhook-session')
  const item = await w.work.act('a', { requestId: 'hook-1', title: 'Triage issue 7', kind: 'file', done: 'a label on issue 7', asked: 'self' })
  expect(item.origin).toEqual({ kind: 'webhook_run', id: run.id })
  expect(item.askedBy).toEqual({ kind: 'webhook', id: hook.id, name: 'Triage new issues' })
})

test('a run continued after compression still counts as the run; an unreadable lineage refuses rather than credits Oscar', async () => {
  const w = workFixture()
  w.database.exec("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('a', 'A', '', '', 'test', 'native-a')")
  const hook = w.webhookStore.create('a', { requestId: 'gh', description: 'Triage new issues', source: 'GitHub', createdBy: 'oscar' }, null, 0)
  w.webhookStore.events.add(hook.id, { deliveryId: null, bodyHash: null }, { item: '{}', size: 2, refusal: null }, 0)
  const [hookRun] = w.webhookStore.claimDue(60_000)
  w.webhookStore.attach(hookRun.id, 'a-webhook-session', 60_000)
  const routine = w.routineStore.create('a', { requestId: 'daily', description: 'Check sales', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'oscar' }, 0, 5)
  const [routineRun] = w.routineStore.claimDue(Date.now() + 1_000_000)
  w.routineStore.attach(routineRun.id, 'a-routine-session', Date.now())
  w.state.roots.set('a-webhook-child', 'a-webhook-session')
  w.state.roots.set('a-routine-child', 'a-routine-session')
  w.state.chats.set('a', 'a-webhook-child')
  const fromHook = await w.work.act('a', { requestId: 'c-1', title: 'Triage issue 8', kind: 'file', done: 'a label on issue 8' })
  expect(fromHook.origin).toEqual({ kind: 'webhook_run', id: hookRun.id })
  expect(fromHook.askedBy).toEqual({ kind: 'webhook', id: hook.id, name: 'Triage new issues' })
  w.state.chats.set('a', 'a-routine-child')
  const fromRoutine = await w.work.act('a', { requestId: 'c-2', title: 'Sales check', kind: 'file', done: 'today’s figure' })
  expect(fromRoutine.origin).toEqual({ kind: 'routine_run', id: routineRun.id })
  expect(fromRoutine.askedBy).toEqual({ kind: 'routine', id: routine.id, name: 'Check sales' })
  w.state.roots.set('a-unreadable', null)
  w.state.chats.set('a', 'a-unreadable')
  await expect(w.work.act('a', { requestId: 'c-3', title: 'Something', kind: 'file', done: 'something done' })).rejects.toThrow('cannot tell where this session came from')
})

test('a group started inside an item gives each member its own child item, asked by the leader; the group’s end drops the unfinished', async () => {
  const { w, d } = joined()
  const parent = await w.open('a')
  const { groupId } = (await d.groups.act('a', { action: 'start', requestId: 'g', purpose: 'Review the plan\nin detail', members: ['b', 'c'], text: 'Check it.' })) as any
  expect((await d.threads.open('a', groupId)).parentId).toBe(parent.id)
  const children = w.work.view(parent.id).children
  expect(children.map(c => [c.id, c.ownerId, c.title, c.origin.kind])).toEqual([
    [`${groupId}:b`, 'b', 'Review the plan', 'group'],
    [`${groupId}:c`, 'c', 'Review the plan', 'group']
  ])
  expect(children[0].askedBy).toEqual({ kind: 'bot', id: 'a', name: 'A' })
  await d.settle()
  const run = d.runs.find(r => r.botId === 'b')!
  expect(run.prompt).toContain(`your work item ${groupId}:b`)
  w.state.chats.set('b', run.chatId)
  const opened = await w.work.act('b', { requestId: 'b1', title: 'My review', kind: 'note', done: 'Three notes on the plan' })
  expect(opened).toMatchObject({ id: `${groupId}:b`, status: 'working', origin: { kind: 'group', id: groupId } })
  await w.work.act('b', { requestId: 'b2', itemId: `${groupId}:b`, status: 'done', result: 'Reviewed', evidence: [proof] })
  await d.threads.cancel(groupId, { kind: 'oscar', id: null, name: 'the owner' })
  expect(w.work.view(`${groupId}:b`).status).toBe('done')
  expect(w.work.view(`${groupId}:c`)).toMatchObject({ status: 'dropped', dropReason: 'The group was stopped by the owner.' })
})
