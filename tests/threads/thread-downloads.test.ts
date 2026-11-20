import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { threadFileRoute } from '../../server/http/thread-file-route'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

const write = (path: string, text: string) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

async function handedFile() {
  const f = delegationFixture()
  write(f.path('a', 'notes/report.txt'), 'hello')
  const { exchanges } = await f.delegation.delegate('a', { requestId: 'r', tasks: [{ to: 'b', task: 'Read it', files: ['notes/report.txt'] }] })
  const id = exchanges[0].exchangeId
  const request = (await f.threads.open('a', id)).messages[0]
  return { f, id, request, copy: request.files![0].path! }
}

test('either participant downloads a delivered copy; other bots, other messages and changed copies are refused', async () => {
  const { f, id, request, copy } = await handedFile()
  for (const bot of ['a', 'b']) {
    const file = await f.threads.file(bot, id, request.id, 0)
    expect(file.name).toBe('report.txt')
    expect(file.data.toString()).toBe('hello')
  }
  await expect(f.threads.file('c', id, request.id, 0)).rejects.toThrow('not a participant')
  await expect(f.threads.file('a', id, request.id, 1)).rejects.toThrow('not delivered')
  await expect(f.threads.file('a', id, 'other-message', 0)).rejects.toThrow('not delivered')
  writeFileSync(f.path('b', copy), 'changed')
  await expect(f.threads.file('a', id, request.id, 0)).rejects.toThrow()
  rmSync(f.path('b', copy))
  symlinkSync(f.path('a', 'notes/report.txt'), f.path('b', copy))
  await expect(f.threads.file('a', id, request.id, 0)).rejects.toThrow()
})

test('the route serves it as a download only to the app itself', async () => {
  const { f, id, request } = await handedFile()
  const hosts = new Set(['lilbot.test'])
  const url = `http://lilbot.test/api/threads/a/${id}/${encodeURIComponent(request.id)}/0`
  const get = (headers: Record<string, string>, path = url) => threadFileRoute(new Request(path, { headers: { host: 'lilbot.test', ...headers } }), hosts, f.threads)
  const ok = await get({})
  expect(ok.status).toBe(200)
  expect(await ok.text()).toBe('hello')
  expect(ok.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''report.txt")
  expect(ok.headers.get('x-content-type-options')).toBe('nosniff')
  expect((await get({ 'sec-fetch-site': 'cross-site' })).status).toBe(403)
  expect((await get({ origin: 'https://elsewhere.test' })).status).toBe(403)
  expect((await get({ host: 'other.test' })).status).toBe(403)
  expect((await get({}, url.replace(/\/0$/, '/x'))).status).toBe(404)
  expect((await get({}, url.replace('/a/', '/c/'))).status).toBe(404)
})

test('the roster says whose task a bot works on while it runs, and nothing once it is done', async () => {
  const f = delegationFixture()
  await f.delegation.delegate('a', { requestId: 'r', tasks: [{ to: 'b', task: 'Check the build' }] })
  expect(f.threads.roster().get('b')?.workingFor).toBeUndefined()
  await f.settle()
  const exchange = f.store.list('b')[0]
  expect(f.threads.roster().get('b')?.workingFor).toEqual({ threadId: exchange.id, name: 'A' })
  expect(f.threads.roster().get('a')).toBeUndefined()
  f.runs[0].finish('Done')
  await f.settle()
  expect(f.threads.roster().get('b')).toBeUndefined()
})
