import { expect, spyOn, test } from 'bun:test'
import { watchHermesActivity } from '../../../server/engines/hermes/hermes-activity'
import { HermesSocket } from '../../../server/engines/hermes/hermes-socket'

test('observer reuses profile sockets, consumes incremental events and drops removed bots', async () => {
  let bots = [
    { id: 'a', engineBotId: 'a' },
    { id: 'b', engineBotId: 'b' }
  ]
  const sockets: any[] = []
  const positions: number[] = []
  const connect = spyOn(HermesSocket, 'connect').mockImplementation(async () => {
    let poll = 0
    const socket = {
      isOpen: true,
      close() {
        this.isOpen = false
      },
      async request(method: string, params: any) {
        if (method === 'session.list') return { sessions: [{ session_id: 'chat', running: true, started_at: Date.now() / 1000 }] }
        positions.push(params.last_sequence)
        return { replay_epoch: 'epoch', last_sequence: ++poll, truncated: false, events: poll === 1 ? [{ seq: 1, type: 'tool.start', payload: { name: 'terminal' } }] : [] }
      }
    }
    sockets.push(socket)
    return socket as unknown as HermesSocket
  })
  const events: any[] = []
  const stop = watchHermesActivity(
    async () => bots,
    e => events.push(e),
    () => undefined
  )
  try {
    await Bun.sleep(1150)
    expect(connect).toHaveBeenCalledTimes(2)
    expect(positions).toEqual([0, 0, 1, 1])
    expect(events.every(e => e.tool === 'terminal')).toBe(true)
    bots = [{ id: 'a', engineBotId: 'a' }]
    await Bun.sleep(1000)
    expect(sockets[1].isOpen).toBe(false)
    expect(sockets[0].isOpen).toBe(true)
  } finally {
    stop()
    connect.mockRestore()
  }
  expect(sockets[0].isOpen).toBe(false)
})

test('a failed profile backs off without reconnecting healthy profiles', async () => {
  const attempts: string[] = []
  const connect = spyOn(HermesSocket, 'connect').mockImplementation(async profile => {
    attempts.push(profile)
    if (profile === 'bad') throw new Error('offline')
    return { isOpen: true, close() {}, request: async () => ({ sessions: [] }) } as unknown as HermesSocket
  })
  const stop = watchHermesActivity(
    async () => [
      { id: 'bad', engineBotId: 'bad' },
      { id: 'good', engineBotId: 'good' }
    ],
    () => {},
    () => undefined
  )
  try {
    await Bun.sleep(3200)
    expect(attempts.filter(id => id === 'good')).toHaveLength(1)
    expect(attempts.filter(id => id === 'bad').length).toBeLessThanOrEqual(3)
  } finally {
    stop()
    connect.mockRestore()
  }
})

test('an epoch change and a truncated delta each trigger only one full read', async () => {
  const positions: number[] = []
  let calls = 0
  const connect = spyOn(HermesSocket, 'connect').mockResolvedValue({
    isOpen: true,
    close() {},
    async request(method: string, params: any) {
      if (method === 'session.list') return { sessions: [{ session_id: 'chat', running: true, started_at: 0 }] }
      positions.push(params.last_sequence)
      calls++
      return { replay_epoch: calls === 1 ? 'old' : 'new', last_sequence: calls === 1 ? 8 : 2, truncated: calls >= 4, events: [] }
    }
  } as unknown as HermesSocket)
  const stop = watchHermesActivity(
    async () => [{ id: 'a', engineBotId: 'a' }],
    () => {},
    () => undefined
  )
  try {
    await Bun.sleep(2150)
    expect(positions).toEqual([0, 8, 0, 2, 0])
  } finally {
    stop()
    connect.mockRestore()
  }
})
