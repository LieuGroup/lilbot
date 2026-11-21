import { expect, test } from 'bun:test'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { addBot, systemFixture } from './system-fixture'

async function withFile(botId = 'b1', name = 'result.txt') {
  const f = systemFixture()
  await f.workspaces.ensure(botId)
  await writeFile(join(f.workspaces.pathFor(botId), name), 'Hello Oscar')
  return f
}
const give = (f: Awaited<ReturnType<typeof withFile>>, args: Record<string, unknown> = {}) =>
  f.call('b1', 'lilbot_give_file', { path: 'result.txt', title: 'Result', requestId: 'r1', ...args })

test('a bot gives a file from its own folder; the item is its own, in the conversation the call came from, and the change is logged', async () => {
  const f = await withFile()
  f.from.set('b1', 'b1-earlier')
  const { data } = await give(f)
  expect(data).toMatchObject({ title: 'Result', kind: 'file', size: 11, url: `/api/library/b1/${data.id}` })
  const page = await f.library.list({ botId: 'b1' })
  expect(page.items).toMatchObject([{ id: data.id, botId: 'b1', title: 'Result', path: 'result.txt', chatId: 'b1-earlier', routineRunId: null, missing: false }])
  expect(f.changes.recent(1).map(({ tool, target, fields }) => ({ tool, target, fields }))).toEqual([{ tool: 'lilbot_give_file', target: data.id, fields: 'path, title' }])
})

test('a call no session reported starting is refused and gives nothing (#174); tool search wrapping the call is matched', async () => {
  const f = await withFile()
  const args = { path: 'result.txt', title: 'Result', requestId: 'r1' }
  expect((await f.call('b1', 'lilbot_give_file', args, false)).error).toContain('Make the same call again')
  expect((await f.library.list({ botId: 'b1' })).total).toBe(0)
  f.calls.saw('b1', 'b1-wrapped', 'tool_call', { name: 'lilbot_give_file', arguments: JSON.stringify(args) })
  await f.call('b1', 'lilbot_give_file', args, false)
  expect((await f.library.list({ botId: 'b1' })).items.map(item => [item.title, item.chatId])).toEqual([['Result', 'b1-wrapped']])
})

test('no argument names a chat, a routine run or another bot: the key and the call decide', async () => {
  const f = await withFile()
  const other = await addBot(f, 'Other')
  const { data } = await give(f, { chatId: 'forged', routineRunId: 'forged', botId: other.id })
  const [item] = (await f.library.list({ botId: 'b1' })).items
  expect(item).toMatchObject({ id: data.id, chatId: 'b1-main', routineRunId: null })
  expect((await f.library.list({ botId: other.id })).total).toBe(0)
})

test('a routine run gives from either of its session aliases, and from a session continued after compressing; the item records the run', async () => {
  const f = await withFile()
  f.routineStore.create('b1', { requestId: 'daily', description: 'Check sales', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'oscar' }, 0, 5)
  const [run] = f.routineStore.claimDue(Date.now() + 1_000_000)
  f.routineStore.attach(run.id, 'live-alias', Date.now())
  f.routineStore.attach(run.id, 'stored-alias', Date.now())
  f.roots.set('continued', 'stored-alias')
  for (const [requestId, chat] of [
    ['a', 'live-alias'],
    ['b', 'stored-alias'],
    ['c', 'continued']
  ]) {
    f.from.set('b1', chat)
    await give(f, { requestId, title: chat })
  }
  const items = (await f.library.list({ botId: 'b1' })).items
  expect(items.map(item => [item.title, item.chatId, item.routineRunId]).sort()).toEqual([
    ['continued', 'continued', run.id],
    ['live-alias', 'live-alias', run.id],
    ['stored-alias', 'stored-alias', run.id]
  ])
})

test('a webhook run, even continued after compressing, gives only once Oscar adds shell, with its own session recorded and no routine run', async () => {
  const f = await withFile()
  const hook = f.webhookStore.create('b1', { requestId: 'gh', description: 'Triage new issues', source: 'GitHub', createdBy: 'oscar' }, null, 0)
  f.webhookStore.events.add(hook.id, { deliveryId: null, bodyHash: null }, { item: '{}', size: 2, refusal: null }, 0)
  const [run] = f.webhookStore.claimDue(60_000)
  f.webhookStore.attach(run.id, 'hook-session', 60_000)
  f.roots.set('hook-continued', 'hook-session')
  f.calls.saw('b1', 'hook-session', 'mcp__lilbot_system__lilbot_give_file', { requestId: 'narrow' })
  expect((await give(f, { requestId: 'narrow', title: 'narrow' })).error).toContain('A webhook run cannot use lilbot_give_file')
  f.webhookStore.setCapabilities('b1', hook.id, ['shell'])
  for (const [requestId, chat] of [
    ['a', 'hook-session'],
    ['b', 'hook-continued']
  ]) {
    f.from.set('b1', chat)
    expect((await give(f, { requestId, title: chat })).data.id).toBeDefined()
  }
  expect((await f.library.list({ botId: 'b1' })).items.map(item => [item.chatId, item.routineRunId]).sort()).toEqual([
    ['hook-continued', null],
    ['hook-session', null]
  ])
})

test('another bot’s routine session gives nothing to that run; a lineage that cannot be read refuses and gives nothing', async () => {
  const f = await withFile()
  const other = await addBot(f, 'Other')
  f.routineStore.create('b1', { requestId: 'daily', description: 'Check sales', schedule: { kind: 'interval', seconds: 600 }, createdBy: 'oscar' }, 0, 5)
  const [run] = f.routineStore.claimDue(Date.now() + 1_000_000)
  f.routineStore.attach(run.id, 'b1-routine-session', Date.now())
  await f.workspaces.ensure(other.id)
  await writeFile(join(f.workspaces.pathFor(other.id), 'result.txt'), 'x')
  f.from.set(other.id, 'b1-routine-session')
  await f.call(other.id, 'lilbot_give_file', { path: 'result.txt', title: 'Not that run', requestId: 'r1' })
  expect((await f.library.list({ botId: other.id })).items[0].routineRunId).toBeNull()
  f.roots.set('unreadable', null)
  f.from.set('b1', 'unreadable')
  expect((await give(f, { requestId: 'r2' })).error).toContain('Try again in a moment')
  expect((await f.library.list({ botId: 'b1' })).total).toBe(0)
})

test('what is not a regular file inside the folder is refused with a plain answer, and nothing is given', async () => {
  const f = await withFile()
  await mkdir(join(f.workspaces.pathFor('b1'), 'folder'))
  await symlink('/etc/hostname', join(f.workspaces.pathFor('b1'), 'link.txt'))
  const refusal = 'Cannot give this file. Use a regular file inside your folder, at most 50 MiB.'
  for (const path of ['missing.txt', '../outside.txt']) expect((await give(f, { path })).error).toBe(refusal)
  expect((await give(f, { path: 'folder' })).error).toBe('Expected a regular file or folder.')
  expect((await give(f, { path: 'link.txt' })).error).toContain('inside this bot')
  expect((await give(f, { title: '   ' })).error).toContain('Invalid arguments')
  expect((await give(f, { requestId: undefined })).error).toContain('Invalid arguments')
  expect((await f.library.list({ botId: 'b1' })).total).toBe(0)
})
