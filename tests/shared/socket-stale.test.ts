import { afterEach, describe, expect, test } from 'bun:test'
import { type ClientSocket, LilBotSocket } from '../../shared/client/socket'

const [CONNECTING, OPEN, CLOSED] = [0, 1, 3]

class FakeSocket implements ClientSocket {
  readyState = CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.readyState = CLOSED
  }
  emitOpen() {
    this.readyState = OPEN
    this.onopen?.()
  }
  emitMessage(frame: unknown) {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }
  emitClose() {
    this.readyState = CLOSED
    this.onclose?.()
  }
}

type Timer = { id: number; delay: number; callback: () => void; cleared: boolean }

function installFakeTimers() {
  const realSet = globalThis.setTimeout
  const realClear = globalThis.clearTimeout
  let nextId = 1
  const timers: Timer[] = []
  globalThis.setTimeout = ((fn: (...args: unknown[]) => void, delay = 0) => {
    const entry: Timer = { id: nextId++, delay: Number(delay), callback: () => fn(), cleared: false }
    timers.push(entry)
    return entry.id as unknown as ReturnType<typeof setTimeout>
  }) as typeof setTimeout
  globalThis.clearTimeout = ((id: ReturnType<typeof setTimeout> | undefined) => {
    const entry = timers.find(t => t.id === (id as unknown as number))
    if (entry) entry.cleared = true
  }) as typeof clearTimeout
  return {
    pendingCount: () => timers.filter(t => !t.cleared).length,
    restore() {
      globalThis.setTimeout = realSet
      globalThis.clearTimeout = realClear
    }
  }
}

function makeClient() {
  const sockets: FakeSocket[] = []
  const client = new LilBotSocket({
    url: 'ws://127.0.0.1:3370/ws',
    createSocket: url => {
      const socket = new FakeSocket(url)
      sockets.push(socket)
      return socket
    }
  })
  return { client, sockets }
}

let restoreTimers: (() => void) | null = null
afterEach(() => {
  restoreTimers?.()
  restoreTimers = null
})

describe('LilBotSocket stale handlers and reconnect timer cleanup', () => {
  test('ignores stale open events after stop() and after socket replacement', () => {
    const { client, sockets } = makeClient()
    const states: boolean[] = []
    client.onConnection(connected => states.push(connected))

    client.connect()
    sockets[0]!.readyState = CLOSED
    client.connect()
    expect(sockets).toHaveLength(2)

    // Stale open on superseded socket must not flip connected or announce.
    sockets[0]!.emitOpen()
    expect(client.connected).toBe(false)
    expect(states).toEqual([])

    sockets[1]!.emitOpen()
    expect(client.connected).toBe(true)
    expect(states).toEqual([true])

    client.stop()
    expect(client.connected).toBe(false)
    expect(states).toEqual([true, false])

    // Late open after stop() must not flip connected back to true.
    sockets[1]!.emitOpen()
    expect(client.connected).toBe(false)
    expect(states).toEqual([true, false])
  })

  test('ignores stale message events after stop() and after socket replacement', () => {
    const { client, sockets } = makeClient()
    let pushCount = 0
    client.onBotsChanged(() => pushCount++)

    client.connect()
    sockets[0]!.emitOpen()
    sockets[0]!.readyState = CLOSED
    client.connect()
    sockets[1]!.emitOpen()

    // Stale message from superseded socket must not deliver push events.
    sockets[0]!.emitMessage({ event: 'bots.changed' })
    expect(pushCount).toBe(0)

    // Current socket still delivers push events normally.
    sockets[1]!.emitMessage({ event: 'bots.changed' })
    expect(pushCount).toBe(1)

    client.stop()
    // Stale message after stop() must not deliver push events.
    sockets[1]!.emitMessage({ event: 'bots.changed' })
    expect(pushCount).toBe(1)
  })

  test('connect() while a reconnect timer is pending clears the earlier timer so close then stop leaves no timer', () => {
    const clock = installFakeTimers()
    restoreTimers = clock.restore

    const { client, sockets } = makeClient()
    client.connect()
    sockets[0]!.emitClose()
    expect(clock.pendingCount()).toBe(1)

    // Calling connect() directly while a reconnect timer is pending clears the first timer.
    client.connect()
    expect(sockets).toHaveLength(2)
    expect(clock.pendingCount()).toBe(0)

    // Closing the replacement schedules only one reconnect timer, and stop() clears it completely.
    sockets[1]!.emitClose()
    expect(clock.pendingCount()).toBe(1)

    client.stop()
    expect(clock.pendingCount()).toBe(0)
  })
})
