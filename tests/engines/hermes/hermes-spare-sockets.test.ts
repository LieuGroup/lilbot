import { expect, test } from 'bun:test'
import type { HermesSocket } from '../../../server/engines/hermes/hermes-socket'
import { SpareSockets } from '../../../server/engines/hermes/hermes-spare-sockets'

/** A stand-in connection: records closes and lets the test close it from the Hermes side. */
function fakeSocket(profile: string) {
  let onClose = () => {}
  const socket = {
    profile,
    isOpen: true,
    closes: 0,
    rebind(_event: unknown, close: () => void) {
      onClose = close
      return socket
    },
    close() {
      socket.closes++
      socket.isOpen = false
    },
    hermesClosed() {
      socket.isOpen = false
      onClose()
    }
  }
  return socket
}
type Fake = ReturnType<typeof fakeSocket>

function pool(limit = 4, idleMs = 60_000) {
  const made: Fake[] = []
  const spares = new SpareSockets(
    async profile => {
      const socket = fakeSocket(profile)
      made.push(socket)
      return socket as unknown as HermesSocket
    },
    limit,
    idleMs
  )
  return { spares, made }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test('a refilled profile hands over its spare once', async () => {
  const { spares, made } = pool()
  expect(await spares.take('bot-a')).toBeNull()
  spares.refill('bot-a')
  await settle()
  expect((await spares.take('bot-a')) as unknown).toBe(made[0])
  expect(await spares.take('bot-a')).toBeNull()
})

test('a spare that is still connecting is not waited for', async () => {
  let finish: (socket: HermesSocket) => void = () => {}
  const spares = new SpareSockets(() => new Promise(resolve => (finish = resolve)))
  spares.refill('bot-a')
  expect(await spares.take('bot-a')).toBeNull()
  finish(fakeSocket('bot-a') as unknown as HermesSocket)
  await settle()
  expect(await spares.take('bot-a')).not.toBeNull()
})

test('a spare Hermes closed is forgotten, and a failed attach leaves none', async () => {
  const { spares, made } = pool()
  spares.refill('bot-a')
  await settle()
  made[0].hermesClosed()
  expect(await spares.take('bot-a')).toBeNull()
  const failing = new SpareSockets(async () => {
    throw new Error('gateway down')
  })
  failing.refill('bot-b')
  await settle()
  expect(await failing.take('bot-b')).toBeNull()
})

test('the least recently opened profile gives up its spare past the limit', async () => {
  const { spares, made } = pool(2)
  spares.refill('bot-a')
  spares.refill('bot-b')
  spares.refill('bot-a')
  spares.refill('bot-c')
  await settle()
  expect(made.find(socket => socket.profile === 'bot-b')?.closes).toBe(1)
  expect(await spares.take('bot-b')).toBeNull()
  expect(await spares.take('bot-a')).not.toBeNull()
  expect(await spares.take('bot-c')).not.toBeNull()
})

test('dropping a profile closes its spare, and idle spares expire', async () => {
  const { spares, made } = pool(4, 5)
  spares.refill('bot-a')
  await settle()
  spares.drop('bot-a')
  await settle()
  expect(made[0].closes).toBe(1)
  expect(await spares.take('bot-a')).toBeNull()
  spares.refill('bot-b')
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(made[1].closes).toBe(1)
  expect(await spares.take('bot-b')).toBeNull()
})
