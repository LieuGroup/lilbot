import { afterAll, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ComputerService } from '../../server/computers/computer-service'
import { startPublicDoor } from '../../server/http/public-door'
import { threadFileRoute } from '../../server/http/thread-file-route'
import { keptId } from '../../shared/thread-schema'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

type Fixture = ReturnType<typeof delegationFixture>
const runsOf = (f: Fixture, bot: string) => f.runs.filter(r => r.botId === bot)

/** A group in which C passed notes.md in its reply (copied into the group folder) and the leader's turn on the round is running. */
async function groupWithFile(f: Fixture) {
  const { groupId } = (await f.groups.act('a', { action: 'start', requestId: 'g', purpose: 'Pick a name', members: ['b', 'c'], text: 'Write notes.md.' })) as any
  await f.settle()
  mkdirSync(f.path('c', ''), { recursive: true })
  writeFileSync(f.path('c', 'notes.md'), 'Pelican wins.\n')
  runsOf(f, 'b')[0].finish('Fine.')
  await f.groups.act('c', { action: 'attach', groupId, files: ['notes.md'] })
  runsOf(f, 'c')[0].finish('Notes attached.')
  await f.settle()
  await f.settle()
  const message = (await f.threads.open('a', groupId)).messages.find(m => m.files?.length)!
  return { groupId: groupId as string, message, copy: join(f.root, '.groups', groupId, message.files![0].path!) }
}

test('the group’s own bots download a file passed in it, from the shared folder and then from the archive; others are refused', async () => {
  const f = delegationFixture()
  const { groupId, message } = await groupWithFile(f)
  for (const bot of ['a', 'b', 'c']) {
    const file = await f.threads.file(bot, groupId, message.id, 0)
    expect(file.name).toBe('notes.md')
    expect(file.data.toString()).toBe('Pelican wins.\n')
  }
  await expect(f.threads.file('d', groupId, message.id, 0)).rejects.toThrow('not a participant')
  await expect(f.threads.file('a', groupId, message.id, 1)).rejects.toThrow('not delivered')
  await f.groups.act('a', { action: 'close', groupId, requestId: 'c', text: 'Done.' })
  expect(existsSync(join(f.root, '.groups', groupId))).toBe(false)
  expect((await f.threads.file('b', groupId, message.id, 0)).data.toString()).toBe('Pelican wins.\n')
  expect(existsSync(join(f.root, '.groups', groupId))).toBe(false)
})

test('a changed or linked copy, another thread’s file and a missing folder are refused, and reading creates nothing', async () => {
  const f = delegationFixture()
  const { groupId, message, copy } = await groupWithFile(f)
  const other = (await f.delegation.delegate('a', { requestId: 'x', tasks: [{ to: 'b', task: 'Look' }] })).exchanges[0].exchangeId
  await expect(f.threads.file('a', other, message.id, 0)).rejects.toThrow('not delivered')
  await expect(f.threads.file('a', groupId, `${other}:none`, 0)).rejects.toThrow('not delivered')
  writeFileSync(copy, 'changed')
  await expect(f.threads.file('a', groupId, message.id, 0)).rejects.toThrow()
  rmSync(copy)
  symlinkSync(f.path('c', 'notes.md'), copy)
  await expect(f.threads.file('a', groupId, message.id, 0)).rejects.toThrow()
  rmSync(join(f.root, '.groups', groupId), { recursive: true })
  await expect(f.threads.file('a', groupId, message.id, 0)).rejects.toThrow()
  expect(existsSync(join(f.root, '.groups', groupId))).toBe(false)
  expect(existsSync(join(f.root, '.archive', '.groups', groupId))).toBe(false)
})

test('the file the leader kept downloads for every bot in the group, checked against its hash', async () => {
  const f = delegationFixture()
  const { groupId } = await groupWithFile(f)
  const closed = (await f.groups.act('a', { action: 'close', groupId, requestId: 'c', text: 'We pick Pelican.', keep: ['notes.md'] })) as any
  const view = await f.threads.open('b', groupId)
  expect(view.group!.kept).toEqual([{ name: 'notes.md', size: 14, fromId: 'c', path: closed.kept[0] }])
  for (const bot of ['a', 'b', 'c']) expect((await f.threads.file(bot, groupId, keptId(groupId), 0)).data.toString()).toBe('Pelican wins.\n')
  await expect(f.threads.file('d', groupId, keptId(groupId), 0)).rejects.toThrow('not a participant')
  await expect(f.threads.file('a', groupId, keptId(groupId), 1)).rejects.toThrow('not delivered')
  writeFileSync(f.path('a', closed.kept[0]), 'changed')
  await expect(f.threads.file('b', groupId, keptId(groupId), 0)).rejects.toThrow()
})

test('the route serves group files as downloads to the app only, and the helper door has no such route', async () => {
  const f = delegationFixture()
  const { groupId, message } = await groupWithFile(f)
  const hosts = new Set(['lilbot.test'])
  const url = `http://lilbot.test/api/threads/b/${groupId}/${encodeURIComponent(message.id)}/0`
  const get = (headers: Record<string, string>, path = url) => threadFileRoute(new Request(path, { headers: { host: 'lilbot.test', ...headers } }), hosts, f.threads)
  const ok = await get({})
  expect(ok.status).toBe(200)
  expect(await ok.text()).toBe('Pelican wins.\n')
  expect(ok.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''notes.md")
  expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
  expect((await get({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  expect((await get({ origin: 'https://elsewhere.test' })).status).toBe(403)
  expect((await get({ host: 'other.test' })).status).toBe(403)
  expect((await get({}, url.replace('/b/', '/d/'))).status).toBe(404)
  const door = startPublicDoor({} as ComputerService, 0)
  try {
    expect((await fetch(new URL(new URL(url).pathname, door.url))).status).toBe(404)
  } finally {
    door.stop(true)
  }
})
