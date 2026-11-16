import { expect, test } from 'bun:test'
import { botCapability } from '../../server/bots/bot-capability'
import { BotService } from '../../server/bots/bot-service'
import { Workspaces } from '../../server/bots/workspaces'
import { createEngineApi } from '../../server/http/engine-api'
import { fakeService } from '../helpers/fake-engine'

const input = { requestId: 'one', name: 'Engineer', function: 'Keeps TypeScript projects tidy.', instructions: 'Help Oscar maintain TypeScript projects.' }

test('only the primary creates; concurrent and later retries return the same bot and greeting', async () => {
  const { service, prefs, store, log } = fakeService()
  await expect(service.createFromBot('b1', input)).rejects.toThrow('Only the primary')
  prefs.setPrimaryBot('b1')
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
  const { service, prefs, memory } = fakeService()
  prefs.setPrimaryBot('b1')
  const other = await service.createBot({ name: 'Other', function: '', instructions: '' })
  const api = createEngineApi(memory, 'secret', 3399, { bots: service })
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
  expect((await call(other.id, { botId: 'b1' })).status).toBe(422)
  const response = await call('b1', { botId: other.id, model: { provider: 'evil', model: 'evil' } })
  expect(response.status).toBe(200)
  const result = await response.json()
  expect((await service.getBot(result.id)).model).toBeNull()
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
