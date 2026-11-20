import { expect, test } from 'bun:test'
import { BotRuntimes } from '../../server/bots/bot-runtimes'
import { fakeService } from '../helpers/fake-engine'

function roster(count: number) {
  const f = fakeService()
  for (let i = 2; i <= count; i++) f.store.save({ ...f.store.get('b1'), id: `b${i}`, engineBotId: `b${i}` })
  f.engine.applyIdentity = async () => ({ abilities: [], memoryConnected: false })
  return f
}

test('startup prepares the first bot alone for a head start, then the rest; pending clears as each bot settles', async () => {
  const { store, engine } = roster(7)
  const started: string[] = []
  const release = new Map<string, () => void>()
  engine.prepareRuntime = id =>
    new Promise<void>(resolve => {
      started.push(id)
      release.set(id, resolve)
    })
  const runtimes = new BotRuntimes(store, engine, undefined, undefined, undefined, { headStartMs: 30 })
  const all = runtimes.initialize(() => 'b4')
  await Bun.sleep(5)
  expect(started).toEqual(['b4'])
  await Bun.sleep(50)
  expect(started).toHaveLength(6)
  release.get('b4')?.()
  await Bun.sleep(5)
  expect(runtimes.pending(store.get('b4'))).toBe(false)
  expect(runtimes.pending(store.get('b5'))).toBe(true)
  for (let i = 0; i < 3; i++) {
    for (const done of release.values()) done()
    await Bun.sleep(5)
  }
  await all
  expect(store.list().every(bot => !runtimes.pending(bot))).toBe(true)
})

test('the rest of the roster does not wait out the head start once the first bot is ready', async () => {
  const { store, engine } = roster(3)
  const started: string[] = []
  engine.prepareRuntime = async id => {
    started.push(id)
  }
  const runtimes = new BotRuntimes(store, engine, undefined, undefined, undefined, { headStartMs: 60_000 })
  await runtimes.initialize(() => 'b2')
  expect(started).toEqual(['b2', 'b1', 'b3'])
})

test('opening a bot prepares it at once, without waiting for bots queued ahead of it', async () => {
  const { store, engine } = roster(7)
  const started: string[] = []
  engine.prepareRuntime = id => {
    started.push(id)
    return id === 'b7' ? Promise.resolve() : new Promise<void>(() => {})
  }
  const runtimes = new BotRuntimes(store, engine)
  void runtimes.initialize()
  await Bun.sleep(5)
  expect(started).toEqual(['b1', 'b2', 'b3', 'b4', 'b5'])
  await runtimes.use(store.get('b7'))
  expect(runtimes.snapshot(store.get('b7'))).not.toBeNull()
})

test('one preparation per bot at a time, shared by the startup pass and a chat that opens meanwhile', async () => {
  const { store, engine } = roster(1)
  let prepares = 0
  let release!: () => void
  engine.prepareRuntime = () => {
    prepares++
    return new Promise<void>(resolve => {
      release = resolve
    })
  }
  const runtimes = new BotRuntimes(store, engine)
  const startup = runtimes.initialize()
  await Bun.sleep(5)
  const opened = runtimes.use(store.get('b1'))
  release()
  await Promise.all([startup, opened])
  expect(prepares).toBe(1)
})

test('a failing bot is retried with pauses until it recovers, and each settle is announced', async () => {
  const { store, engine } = roster(2)
  let failures = 2
  engine.prepareRuntime = async id => {
    if (id === 'b2' && failures-- > 0) throw new Error('refused')
  }
  let announced = 0
  const runtimes = new BotRuntimes(store, engine, undefined, undefined, undefined, { retryDelays: [5, 5], changed: () => announced++ })
  await runtimes.initialize()
  expect(runtimes.snapshot(store.get('b2'))).toBeNull()
  for (let i = 0; i < 100 && !runtimes.snapshot(store.get('b2')); i++) await Bun.sleep(5)
  expect(runtimes.snapshot(store.get('b2'))).not.toBeNull()
  expect(failures).toBe(-1)
  expect(announced).toBeGreaterThanOrEqual(4)
})

test('a failed preparation reaches the caller who opened that bot, and a deleted bot is not retried', async () => {
  const { store, engine } = roster(2)
  let attempts = 0
  engine.prepareRuntime = async id => {
    if (id === 'b2') {
      attempts++
      throw new Error('refused')
    }
  }
  const runtimes = new BotRuntimes(store, engine, undefined, undefined, undefined, { retryDelays: [5] })
  await expect(runtimes.use(store.get('b2'))).rejects.toThrow('refused')
  store.markDeleted(store.get('b2'), { files: 'archive', privateMemories: 'forget' })
  await runtimes.release('b2')
  await Bun.sleep(30)
  expect(attempts).toBe(1)
})
