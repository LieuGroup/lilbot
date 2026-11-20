import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import { BotService } from '../../server/bots/bot-service'
import { Workspaces } from '../../server/bots/workspaces'
import { createEngineApi } from '../../server/http/engine-api'
import { fakeService } from '../helpers/fake-engine'

const input = { requestId: 'one', name: 'Engineer', function: 'Keeps TypeScript projects tidy.', instructions: 'Help Oscar maintain TypeScript projects.' }

test('any bot creates, not only the primary; concurrent and later retries return the same bot and greeting', async () => {
  const { service, prefs, store, log } = fakeService()
  expect(prefs.primaryBot()).toBeNull()
  await service.updateBot({ botId: 'b1', model: { provider: 'test', model: 'chosen' } })
  const [first, second] = await Promise.all([service.createFromBot('b1', input), service.createFromBot('b1', input)])
  expect(first).toEqual(second)
  expect(await service.createFromBot('b1', input)).toEqual(first)
  expect(store.list()).toHaveLength(2)
  expect(store.get(first.id)).toMatchObject({ instructions: input.instructions, function: input.function, model: { provider: 'test', model: 'chosen' } })
  expect(prefs.mainChat(first.id)).toBeTruthy()
  expect(log.filter(line => line.startsWith('send:'))).toHaveLength(1)
  expect(log).toContain(`hidden:greeting-${first.id}`)
  expect(log).toContain(`connect-memory:${first.id}`)
})

test('endpoint resolves credential owner and ignores model-supplied bot ids and model', async () => {
  const { service, prefs, memory, store } = fakeService()
  prefs.setPrimaryBot('b1')
  const other = await service.createBot({ name: 'Other', function: '', instructions: '' })
  const api = createEngineApi(memory, 'secret', 3399, { bots: service, botExists: id => store.exists(id) })
  async function call(owner: string, extra: object) {
    return api(
      new Request('http://localhost:3399/engine/bots/create', {
        method: 'POST',
        headers: { host: 'localhost:3399', authorization: 'Bearer secret', 'x-lilbot-bot-capability': botCapability('secret', owner) },
        body: JSON.stringify({ ...input, ...extra })
      }),
      '/engine/bots/create'
    )
  }
  // A bot that is not the primary may create too; the id a request makes belongs to its caller, whatever body ids say.
  const fromOther = await call(other.id, { botId: 'b1' })
  expect(fromOther.status).toBe(200)
  const response = await call('b1', { botId: other.id, model: { provider: 'evil', model: 'evil' } })
  expect(response.status).toBe(200)
  const result = await response.json()
  expect((await service.getBot(result.id)).model).toBeNull()
  expect((await fromOther.json()).id).not.toBe(result.id)
})

test('secrets in generated instructions are refused before creation', async () => {
  const { service, prefs, store } = fakeService()
  prefs.setPrimaryBot('b1')
  await expect(service.createFromBot('b1', { ...input, instructions: 'password: supersecret' })).rejects.toThrow('password')
  expect(store.list()).toHaveLength(1)
})

test('a new service after restart remembers the completed request', async () => {
  const { service, engine, prefs, store, memory, root, log } = fakeService()
  prefs.setPrimaryBot('b1')
  const first = await service.createFromBot('b1', input)
  const restarted = new BotService(engine, store, prefs, new Workspaces(root), memory)
  expect(await restarted.createFromBot('b1', input)).toEqual(first)
  expect(store.list()).toHaveLength(2)
  expect(log.filter(line => line.startsWith('send:'))).toHaveLength(1)
})

test('a bot created by the primary can be deleted without reviving it on a retried request', async () => {
  const f = fakeService()
  try {
    f.prefs.setPrimaryBot('b1')
    const created = await f.service.createFromBot('b1', input)
    expect(f.store.creationDone(created.id)).toBe(true)
    await f.service.deleteBot({ botId: created.id })
    expect(f.store.creationDone(created.id)).toBe(false)
    expect(f.runtimeIds.has(created.id)).toBe(false)
    expect((await f.service.listBots()).map(bot => bot.id)).toEqual(['b1'])
    await expect(f.service.createFromBot('b1', input)).rejects.toThrow('deleted')
    // A late greeting completion must not restore the creation marker.
    f.store.finishCreation(created.id)
    expect(f.store.creationDone(created.id)).toBe(false)
    await expect(f.service.deleteBot({ botId: 'b1' })).rejects.toThrow('Choose another primary bot')
  } finally {
    await import('node:fs/promises').then(fs => fs.rm(f.root, { recursive: true, force: true }))
  }
})

test('a deleted primary capability is refused even after engine deletion fails', async () => {
  const f = fakeService()
  try {
    f.prefs.setPrimaryBot('b1')
    const created = await f.service.createFromBot('b1', input)
    f.prefs.setPrimaryBot(created.id)
    const api = createEngineApi(f.memory, 'secret', 3399, { bots: f.service, botExists: id => f.store.exists(id) })
    const call = () =>
      api(
        new Request('http://localhost:3399/engine/bots/create', {
          method: 'POST',
          headers: { host: 'localhost:3399', authorization: 'Bearer secret', 'x-lilbot-bot-capability': botCapability('secret', 'b1') },
          body: JSON.stringify({ ...input, requestId: 'after-delete', botId: created.id })
        }),
        '/engine/bots/create'
      )
    f.engine.deleteRuntime = async () => {
      throw new Error('offline')
    }
    await expect(f.service.deleteBot({ botId: 'b1' })).rejects.toThrow('offline')
    expect((await call()).status).toBe(403)
    f.engine.deleteRuntime = async id => {
      f.runtimeIds.delete(id)
    }
    await f.service.deleteBot({ botId: 'b1' })
    expect((await call()).status).toBe(403)
  } finally {
    await import('node:fs/promises').then(fs => fs.rm(f.root, { recursive: true, force: true }))
  }
})

test('unknown capability owners are refused, including a stale resolved roster entry', async () => {
  const f = fakeService()
  const roster = await f.service.listBots()
  const api = createEngineApi(f.memory, 'secret', 3399, { bots: f.service, botExists: id => f.store.exists(id) })
  const call = (id: string) =>
    api(
      new Request('http://localhost:3399/engine/bots/create', {
        method: 'POST',
        headers: { host: 'localhost:3399', authorization: 'Bearer secret', 'x-lilbot-bot-capability': botCapability('secret', id) },
        body: JSON.stringify(input)
      }),
      '/engine/bots/create'
    )
  try {
    expect((await call('never-owned')).status).toBe(403)
    // A roster fetched just before deletion must not authorize a now-deleted owner.
    f.store.markDeleted(f.store.get('b1'), { files: 'archive', privateMemories: 'keep' })
    f.service.listBots = async () => roster
    expect((await call('b1')).status).toBe(403)
  } finally {
    await import('node:fs/promises').then(fs => fs.rm(f.root, { recursive: true, force: true }))
  }
})
