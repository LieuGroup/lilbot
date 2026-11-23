import { afterEach, describe, expect, test } from 'bun:test'
import { type ClientSocket, LilBotSocket } from '../../shared/client/socket'
import { LilBotError } from '../../shared/lilbot-error'

const [CONNECTING, OPEN, CLOSED] = [0, 1, 3]

class FakeSocket implements ClientSocket {
  readyState = CONNECTING
  sent: string[] = []
  closedCount = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: (() => void) | null = null
  constructor(readonly url: string) {}
  send(data: string) {
    this.sent.push(data)
  }
  close() {
    this.closedCount++
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
    runNext() {
      const next = timers.find(t => !t.cleared)
      if (!next) throw new Error('No pending timer')
      next.cleared = true
      next.callback()
      return next
    },
    pendingCount: () => timers.filter(t => !t.cleared).length,
    restore() {
      globalThis.setTimeout = realSet
      globalThis.clearTimeout = realClear
    }
  }
}

function makeClient(opts?: { reconnectDelaysMs?: number[]; url?: string | (() => string) }) {
  const sockets: FakeSocket[] = []
  const client = new LilBotSocket({
    url: opts?.url ?? 'ws://127.0.0.1:3370/ws',
    reconnectDelaysMs: opts?.reconnectDelaysMs,
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

describe('LilBotSocket', () => {
  test('connect() is a no-op while already connecting or open', () => {
    const { client, sockets } = makeClient()
    client.connect()
    client.connect()
    expect(sockets).toHaveLength(1)
    sockets[0]!.emitOpen()
    expect(client.connected).toBe(true)
    client.connect()
    expect(sockets).toHaveLength(1)
    client.stop()
  })

  test('reconnects with escalating default delays, clamps at max, resets after open, and honours custom delays', () => {
    const clock = installFakeTimers()
    restoreTimers = clock.restore

    const { client, sockets } = makeClient({ url: () => 'ws://127.0.0.1:3370/ws' })
    client.connect()
    const delays: number[] = []
    for (let i = 0; i < 5; i++) {
      sockets[i]!.emitClose()
      delays.push(clock.runNext().delay)
    }
    expect(delays).toEqual([1000, 2000, 5000, 10_000, 10_000])
    expect(sockets).toHaveLength(6)
    sockets[5]!.emitOpen()
    sockets[5]!.emitClose()
    expect(clock.runNext().delay).toBe(1000)
    client.stop()
    expect(clock.pendingCount()).toBe(0)

    const custom = makeClient({ reconnectDelaysMs: [25, 75] })
    custom.client.connect()
    const customDelays: number[] = []
    for (let i = 0; i < 3; i++) {
      custom.sockets[i]!.emitClose()
      customDelays.push(clock.runNext().delay)
    }
    expect(customDelays).toEqual([25, 75, 75])
    custom.client.stop()
  })

  test('times out unanswered calls at 90s and ignores late responses', async () => {
    const clock = installFakeTimers()
    restoreTimers = clock.restore

    const { client, sockets } = makeClient()
    client.connect()
    sockets[0]!.emitOpen()

    const pending = client.call('bots.list', {})
    const firstFrame = JSON.parse(sockets[0]!.sent[0]!) as { id: number; method: string }
    expect(firstFrame.method).toBe('bots.list')
    expect(clock.runNext().delay).toBe(90_000)
    await expect(pending).rejects.toBeInstanceOf(LilBotError)
    await expect(pending).rejects.toMatchObject({ code: 'timeout' })

    sockets[0]!.emitMessage({ id: firstFrame.id, ok: true, result: [] })
    const second = client.call('bots.list', {})
    const secondFrame = JSON.parse(sockets[0]!.sent[1]!) as { id: number }
    sockets[0]!.emitMessage({ id: secondFrame.id, ok: true, result: [] })
    await expect(second).resolves.toEqual([])
    expect(clock.pendingCount()).toBe(0)
    client.stop()
  })

  test('close clears the socket, rejects pending calls, and ignores stale close events', async () => {
    const clock = installFakeTimers()
    restoreTimers = clock.restore

    const { client, sockets } = makeClient()
    const states: boolean[] = []
    client.onConnection(connected => states.push(connected))

    client.connect()
    sockets[0]!.emitOpen()
    const inFlight = client.call('bots.list', {})
    sockets[0]!.emitClose()

    await expect(inFlight).rejects.toBeInstanceOf(LilBotError)
    await expect(inFlight).rejects.toMatchObject({ code: 'disconnected' })
    expect(client.connected).toBe(false)
    expect(states).toEqual([true, false])
    await expect(client.call('bots.list', {})).rejects.toMatchObject({ code: 'disconnected' })

    expect(clock.runNext().delay).toBe(1000)
    sockets[1]!.emitOpen()
    sockets[1]!.readyState = CLOSED
    client.connect()
    sockets[2]!.emitOpen()

    const whileStale = client.call('bots.list', {})
    const frame = JSON.parse(sockets[2]!.sent[0]!) as { id: number }
    expect(clock.pendingCount()).toBe(1)
    sockets[1]!.onclose?.()
    expect(client.connected).toBe(true)
    expect(states).toEqual([true, false, true, true])
    expect(clock.pendingCount()).toBe(1)
    sockets[2]!.emitMessage({ id: frame.id, ok: true, result: [] })
    await expect(whileStale).resolves.toEqual([])
    expect(clock.pendingCount()).toBe(0)

    client.stop()
    expect(sockets[2]!.closedCount).toBe(1)
    expect(clock.pendingCount()).toBe(0)
    client.connect()
    expect(sockets).toHaveLength(3)
    await expect(client.call('bots.list', {})).rejects.toMatchObject({ code: 'disconnected' })
  })
})
