import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { botCapability } from '../../server/bots/bot-capability'
import type { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { openDatabase } from '../../server/database/database'
import { createEngineApi } from '../../server/http/engine-api'
import { LibraryService } from '../../server/library/library-service'
import { LibraryStore } from '../../server/library/library-store'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import type { RoutineService } from '../../server/routines/routine-service'
import { RoutineStore } from '../../server/routines/routine-store'
import { detail } from '../helpers/fake-engine'

let root: string
let db: ReturnType<typeof openDatabase>
let service: LibraryService
let store: LibraryStore
let workspaces: Workspaces
let active: Set<string>
let changes: string[]
beforeEach(async () => {
  root = await mkdtemp(join(homedir(), 'agent-tmp/library-test-'))
  db = openDatabase(':memory:')
  workspaces = new Workspaces(join(root, 'workspaces'))
  await workspaces.ensure('bot')
  await workspaces.ensure('other')
  active = new Set(['bot', 'other'])
  changes = []
  store = new LibraryStore(db)
  service = new LibraryService(
    store,
    id => workspaces.pathFor(id),
    id => active.has(id),
    id => changes.push(id)
  )
  await writeFile(join(workspaces.pathFor('bot'), 'file.txt'), 'Hello Oscar')
})
afterEach(async () => {
  db.close()
  await rm(root, { recursive: true, force: true })
})
const give = (path = 'file.txt') => service.give('bot', { path, title: 'A result', chatId: 'chat' })

test('only delivered files appear; metadata, newest first, filters, paging and content', async () => {
  expect((await service.list({ botId: 'bot' })).total).toBe(0)
  const first = await give()
  for (const name of ['image.png', 'page.md']) {
    await writeFile(join(workspaces.pathFor('bot'), name), 'content')
    await give(name)
  }
  const page = await service.list({ botId: 'bot', limit: 1 })
  expect(page.total).toBe(3)
  expect(page.nextOffset).toBe(1)
  expect(page.items[0]).toMatchObject({ title: 'A result', kind: 'page', group: 'today', chatId: 'chat', missing: false })
  expect((await service.list({ botId: 'bot', kind: 'media' })).items[0].path).toBe('image.png')
  expect((await service.list({ botId: 'bot', offset: 2 })).items[0].id).toBe(first.id)
  expect((await service.content('bot', first.id)).data.toString()).toBe('Hello Oscar')
  expect(changes).toEqual(['bot', 'bot', 'bot'])
  await expect(service.content('other', first.id)).rejects.toThrow('does not exist')
})
test('required title and provenance; routine delivery', async () => {
  await expect(service.give('bot', { path: 'file.txt', title: ' ', chatId: 'c' })).rejects.toThrow()
  await expect(service.give('bot', { path: 'file.txt', title: 'Result' })).rejects.toThrow()
  expect((await service.give('bot', { path: 'file.txt', title: 'Result', routineRunId: 'run-1' })).routineRunId).toBe('run-1')
})
test('traversal, other bot, symlink escape, directories, oversized files and replaced links are refused', async () => {
  await writeFile(join(root, 'secret'), 'outside')
  await symlink(root, join(workspaces.pathFor('bot'), 'escape'))
  await mkdir(join(workspaces.pathFor('bot'), 'folder'))
  await writeFile(join(workspaces.pathFor('other'), 'file.txt'), 'other')
  for (const path of ['../../secret', join(root, 'secret'), 'escape/secret', '../other/file.txt', 'folder']) await expect(give(path)).rejects.toThrow()
  const item = await give()
  await rm(join(workspaces.pathFor('bot'), 'file.txt'))
  await symlink(join(root, 'secret'), join(workspaces.pathFor('bot'), 'file.txt'))
  await expect(service.content('bot', item.id)).rejects.toThrow()
  expect((await service.list({ botId: 'bot' })).items[0].missing).toBe(true)
  await writeFile(join(workspaces.pathFor('bot'), 'large'), '')
  await truncate(join(workspaces.pathFor('bot'), 'large'), 50 * 1024 * 1024 + 1)
  await expect(give('large')).rejects.toThrow('50 MiB')
})
test('safe internal symlinks; missing files persist; workspace is separate', async () => {
  await symlink('file.txt', join(workspaces.pathFor('bot'), 'alias'))
  const item = await give('alias')
  expect(item.path).toBe('file.txt')
  await rm(join(workspaces.pathFor('bot'), 'file.txt'))
  expect((await service.list({ botId: 'bot' })).items[0].missing).toBe(true)
  await writeFile(join(workspaces.pathFor('bot'), 'working.txt'), 'not delivered')
  expect((await service.workspace('bot')).map(entry => entry.name)).toEqual(['working.txt'])
  expect((await service.list({ botId: 'bot' })).total).toBe(1)
})
test.each(['archive', 'delete'] as const)('deletion %s preserves metadata but revokes access', async choice => {
  const item = await give()
  active.delete('bot')
  await workspaces.remove('bot', choice)
  await expect(service.list({ botId: 'bot' })).rejects.toThrow('does not exist')
  await expect(service.content('bot', item.id)).rejects.toThrow('does not exist')
  await expect(give()).rejects.toThrow('does not exist')
  expect(store.get('bot', item.id)).not.toBeNull()
  const archived = Bun.file(join(root, 'workspaces', '.archive', 'bot', 'file.txt'))
  expect(await archived.exists()).toBe(choice === 'archive')
})
test('engine delivery requires token and bot credential; ignores forged bot id', async () => {
  const bots = { listBots: async () => [...active].map(id => ({ id })) } as unknown as BotService
  const api = createEngineApi(new MemoryService(new MemoryStore(db)), 'token', 3371, { bots, library: service, botExists: id => active.has(id) })
  const call = (capability: string, extra = {}) =>
    api(
      new Request('http://127.0.0.1:3371/engine/library/give', {
        method: 'POST',
        headers: { host: '127.0.0.1:3371', authorization: 'Bearer token', 'x-lilbot-bot-capability': capability, ...extra },
        body: JSON.stringify({ botId: 'other', path: 'file.txt', title: 'Result', chatId: 'chat' })
      }),
      '/engine/library/give'
    )
  expect((await call('bad')).status).toBe(403)
  expect((await call(botCapability('token', 'bot'), { authorization: '' })).status).toBe(403)
  expect((await call(botCapability('token', 'bot'), { origin: 'http://127.0.0.1:3371' })).status).toBe(403)
  const response = await call(botCapability('token', 'bot'))
  expect(response.status).toBe(200)
  expect((await response.json()).item.botId).toBe('bot')
  active.delete('bot')
  expect((await call(botCapability('token', 'bot'))).status).toBe(403)
})

test('date groups and content URLs', async () => {
  const item = await give()
  store.add({ ...item, id: 'old', createdAt: Date.now() - 15 * 86400000 })
  const page = await service.list({ botId: 'bot' })
  expect(page.items[1].group).toBe('older')
  expect(() => service.contentUrl('other', item.id)).toThrow('does not exist')
  expect(service.contentUrl('bot', item.id).url).toContain(item.id)
})

test('engine deliveries resolve both routine session aliases to the owned run, ignoring forged provenance', async () => {
  new BotStore(db).import('test', [{ ...detail, id: 'bot', engineId: 'test', engineBotId: 'bot' }])
  const routines = new RoutineStore(db)
  routines.create('bot', { requestId: 'one', description: 'Deliver', schedule: { kind: 'interval', seconds: 300 }, createdBy: 'oscar' }, 0, 5)
  const [run] = routines.claimDue(300_000)
  routines.attach(run.id, 'live-alias', 300_000)
  routines.attach(run.id, 'stored-alias', 300_000)
  const bots = { listBots: async () => [...active].map(id => ({ id })) } as unknown as BotService
  const api = createEngineApi(new MemoryService(new MemoryStore(db)), 'token', 3371, {
    bots,
    library: service,
    botExists: id => active.has(id),
    routines: { store: new RoutineStore(db) } as RoutineService
  })
  for (const [botId, chatId, expected] of [
    ['bot', 'live-alias', run.id],
    ['bot', 'stored-alias', run.id],
    ['bot', 'ordinary-chat', null],
    ['other', 'live-alias', null]
  ]) {
    await writeFile(join(workspaces.pathFor(botId!), 'file.txt'), 'Result')
    const response = await api(
      new Request('http://localhost:3371/engine/library/give', {
        method: 'POST',
        headers: { host: 'localhost:3371', authorization: 'Bearer token', 'x-lilbot-bot-capability': botCapability('token', botId!) },
        body: JSON.stringify({ path: 'file.txt', title: 'Result', chatId, routineRunId: 'forged' })
      }),
      '/engine/library/give'
    )
    expect(response.status).toBe(200)
    expect((await response.json()).item).toMatchObject({ botId, chatId, routineRunId: expected })
  }
})
