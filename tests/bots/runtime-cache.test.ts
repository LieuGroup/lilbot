import { expect, test } from 'bun:test'
import { BotRuntimes } from '../../server/bots/bot-runtimes'
import { LilBotError } from '../../shared/protocol'
import { fakeService } from '../helpers/fake-engine'

test('concurrent startup prepares once; repeated roster, detail and preference reads use the snapshot', async () => {
  const { service, engine } = fakeService()
  let prepares = 0,
    applies = 0
  engine.prepareRuntime = async () => {
    prepares++
  }
  engine.applyIdentity = async () => {
    applies++
    return { abilities: [{ kind: 'toolset', id: 'terminal', label: 'Terminal', enabled: true }], memoryConnected: true }
  }
  await Promise.all([service.listBots(), service.getBot('b1'), service.listBots()])
  for (let i = 0; i < 5; i++) {
    expect((await service.getBot('b1')).abilities).toEqual([{ kind: 'toolset', id: 'terminal', label: 'Terminal', enabled: true }])
    await service.listBots()
    await service.setPrefs({ botId: 'b1', pinned: true })
  }
  expect(prepares).toBe(1)
  expect(applies).toBe(1)
  await service.updateBot({ botId: 'b1', name: 'Renamed' })
  expect(applies).toBe(2)
  expect(prepares).toBe(1)
})

test('runtime disappearance invalidates cached availability and return refreshes it', async () => {
  const { store, engine } = fakeService()
  const runtimes = new BotRuntimes(store, engine)
  await runtimes.initialize()
  await runtimes.runtimeAvailability('b1', false)
  expect(await runtimes.available(store.get('b1'))).toBe(false)
  engine.applyIdentity = async () => ({ abilities: [{ kind: 'toolset', id: 'new', label: 'New', enabled: true }], memoryConnected: true })
  await runtimes.runtimeAvailability('b1', true)
  expect(await runtimes.optionalState(store.get('b1'))).toEqual({ abilities: [{ kind: 'toolset', id: 'new', label: 'New', enabled: true }], memoryConnected: true })
})

test('failed startup retries do not prepare successfully prepared bots again', async () => {
  const { store, engine } = fakeService()
  let prepares = 0
  engine.prepareRuntime = async () => {
    prepares++
  }
  engine.applyIdentity = async () => {
    throw new Error('temporary failure')
  }
  const runtimes = new BotRuntimes(store, engine)
  await expect(runtimes.initialize()).rejects.toThrow('temporary failure')
  engine.applyIdentity = async () => ({ abilities: [], memoryConnected: false })
  await runtimes.initialize()
  expect(prepares).toBe(1)
})

test('missing runtime reported during use makes subsequent reads unavailable without retries', async () => {
  const { store, engine } = fakeService()
  const runtimes = new BotRuntimes(store, engine)
  await runtimes.initialize()
  engine.applyIdentity = async () => {
    throw new LilBotError('bot_not_found', 'gone')
  }
  await expect(runtimes.state(store.get('b1'))).rejects.toThrow('gone')
  expect(await runtimes.available(store.get('b1'))).toBe(false)
})
