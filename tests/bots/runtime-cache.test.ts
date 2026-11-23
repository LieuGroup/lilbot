import { expect, test } from 'bun:test'
import { BotRuntimes } from '../../server/bots/bot-runtimes'
import { LilBotError } from '../../shared/lilbot-error'
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
  await service.prepareRuntimes()
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
  await runtimes.runtimeAvailability('native-b1', false)
  expect(runtimes.snapshot(store.get('b1')) !== null).toBe(false)
  engine.applyIdentity = async () => ({ abilities: [{ kind: 'toolset', id: 'new', label: 'New', enabled: true }], memoryConnected: true })
  await runtimes.runtimeAvailability('native-b1', true)
  expect(runtimes.snapshot(store.get('b1'))).toEqual({ abilities: [{ kind: 'toolset', id: 'new', label: 'New', enabled: true }], memoryConnected: true })
})

test('a bot that fails to prepare settles as unavailable; a retry prepares only that bot', async () => {
  const { store, engine } = fakeService()
  store.save({ ...store.get('b1'), id: 'b2', engineBotId: 'native-b2' })
  const prepared: string[] = []
  engine.prepareRuntime = async id => {
    if (id === 'native-b2' && fail) throw new Error('temporary failure')
    prepared.push(id)
  }
  let fail = true
  engine.applyIdentity = async () => ({ abilities: [], memoryConnected: false })
  const runtimes = new BotRuntimes(store, engine, undefined, undefined, undefined, { retryDelays: [1_000_000] })
  await runtimes.initialize()
  expect(prepared).toEqual(['native-b1'])
  expect(runtimes.snapshot(store.get('b2'))).toBeNull()
  expect(runtimes.pending(store.get('b2'))).toBe(false)
  fail = false
  await runtimes.use(store.get('b2'))
  expect(prepared).toEqual(['native-b1', 'native-b2'])
  expect(runtimes.snapshot(store.get('b2'))).not.toBeNull()
})

test('missing runtime reported during use makes subsequent reads unavailable without retries', async () => {
  const { store, engine } = fakeService()
  const runtimes = new BotRuntimes(store, engine)
  await runtimes.initialize()
  engine.applyIdentity = async () => {
    throw new LilBotError('bot_not_found', 'gone')
  }
  await expect(runtimes.state(store.get('b1'))).rejects.toThrow('gone')
  expect(runtimes.snapshot(store.get('b1')) !== null).toBe(false)
})

test('only a changed permission mode prepares policy during updates', async () => {
  const { store, engine } = fakeService()
  Object.defineProperty(engine, 'supportedPermissionModes', { value: ['full-access', 'auto'] })
  const prepared: string[] = []
  engine.prepareRuntime = async (_id, identity) => {
    prepared.push(identity.permissionMode)
  }
  const runtimes = new BotRuntimes(store, engine)
  await runtimes.initialize()
  await runtimes.update({ botId: 'b1', permissionMode: 'full-access' })
  await runtimes.update({ botId: 'b1', permissionMode: 'auto' })
  expect(prepared).toEqual(['full-access', 'auto'])
})

test('roster reads return pending identities while preparation is blocked', async () => {
  const { service, engine } = fakeService()
  let release!: () => void
  engine.prepareRuntime = () =>
    new Promise<void>(resolve => {
      release = resolve
    })
  const preparation = service.prepareRuntimes()
  await Bun.sleep(0)
  expect(await service.listBots()).toMatchObject([{ id: 'b1', runnable: false, runtimePending: true }])
  expect(await service.getBot('b1')).toMatchObject({ runtimePending: true })
  release()
  await preparation
  expect(await service.listBots()).toMatchObject([{ id: 'b1', runnable: true, runtimePending: false }])
})

test('startup prepares only active bindings for this engine using native ids', async () => {
  const { store, engine } = fakeService()
  store.bind('b1', 'owned-native')
  store.save({ ...store.get('b1'), id: 'deleted', engineBotId: 'deleted-native' })
  store.markDeleted(store.get('deleted'), { files: 'archive', privateMemories: 'forget' })
  store.save({ ...store.get('b1'), id: 'other', engineId: 'other', engineBotId: 'other-native' })
  const prepared: string[] = []
  engine.prepareRuntime = async id => {
    prepared.push(id)
  }
  engine.importBots = async () => {
    throw new Error('must not enumerate profiles')
  }
  engine.applyIdentity = async () => ({ abilities: [], memoryConnected: false })
  await new BotRuntimes(store, engine).initialize()
  expect(prepared).toEqual(['owned-native'])
})
