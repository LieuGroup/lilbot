import { expect, test } from 'bun:test'
import { workFixture } from './work-fixture'

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => '',
    (error: Error & { code?: string }) => error.code ?? error.message
  )

test('an item states its kind; its level starts at the kind’s default and can be raised, never lowered', async () => {
  const f = workFixture()
  expect(await refusal(f.work.act('a', { requestId: 'k0', title: 'Ship it', done: 'live' }))).toBe('work_no_kind')
  expect(await refusal(f.open('a', { kind: 'deploy', level: 1 }))).toBe('work_level')
  const deploy = await f.open('a', { kind: 'deploy' })
  expect(deploy).toMatchObject({ kind: 'deploy', checkLevel: 2, defaultLevel: 2, check: null, checks: [] })
  const reply = await f.open('a', { kind: 'reply' })
  expect(reply).toMatchObject({ checkLevel: 0, defaultLevel: 0 })
  expect((await f.open('a', { kind: 'file', level: 3 })).checkLevel).toBe(3)
  expect(await refusal(f.work.act('a', { requestId: 'k1', itemId: deploy.id, level: 1 }))).toBe('work_level')
  expect((await f.work.act('a', { requestId: 'k2', itemId: reply.id, level: 2 })).checkLevel).toBe(2)
  expect(await refusal(f.work.act('a', { requestId: 'k3', itemId: deploy.id, kind: 'note' }))).toBe('work_kind')
})

test('Oscar sets the default per kind and per kind for one bot; the bot’s wins, null goes back, a deleted bot’s go', async () => {
  const f = workFixture()
  await f.board.setLevel({ kind: 'file', level: 2 })
  await f.board.setLevel({ kind: 'file', botId: 'b', level: 3 })
  await f.board.setLevel({ kind: 'deploy', level: 1 })
  expect(f.board.levels().kinds.find(k => k.kind === 'file')).toEqual({ kind: 'file', builtIn: 1, level: 2, bots: { b: 3 } })
  expect(await refusal(f.open('a', { level: 1 }))).toBe('work_level')
  expect(await f.open('a')).toMatchObject({ checkLevel: 2, defaultLevel: 2 })
  expect((await f.open('b')).checkLevel).toBe(3)
  expect((await f.open('a', { kind: 'deploy' })).checkLevel).toBe(1)
  await f.board.setLevel({ kind: 'file', level: null })
  expect((await f.open('a')).checkLevel).toBe(1)
  expect(await refusal(f.board.setLevel({ kind: 'file', botId: 'nobody', level: 2 }))).toBe('bot_not_found')
  f.links.forgetBot('b')
  expect(f.board.levels().kinds.find(k => k.kind === 'file')!.bots).toEqual({})
})

test('the item LilBot opens for an exchange takes its kind from the receiver, at that kind’s default or higher', async () => {
  const f = workFixture()
  const parent = await f.open('a')
  f.links.child(parent.id, { id: 'ex1', owner: { id: 'b', name: 'B' }, asker: { id: 'a', name: 'A' }, task: 'Deploy the site' })
  expect(f.work.view('ex1')).toMatchObject({ kind: null, checkLevel: 1, defaultLevel: null })
  expect(await refusal(f.work.act('b', { requestId: 'r1', itemId: 'ex1', done: 'the site is live', status: 'working' }))).toBe('work_no_kind')
  expect(await refusal(f.work.act('b', { requestId: 'r2', itemId: 'ex1', kind: 'deploy', level: 1 }))).toBe('work_level')
  const started = await f.work.act('b', { requestId: 'r3', itemId: 'ex1', kind: 'deploy', done: 'the site is live', status: 'working' })
  expect(started).toMatchObject({ kind: 'deploy', checkLevel: 2, defaultLevel: 2, status: 'working' })
})
