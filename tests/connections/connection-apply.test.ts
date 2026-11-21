import { expect, test } from 'bun:test'
import { type ApplyHost, ConnectionApplier, connectedPrompt } from '../../server/connections/connection-apply'
import type { ConnectionsApplied } from '../../server/engines/mcp-connection'

function fixture() {
  const log: string[] = []
  const states = new Map<string, ConnectionsApplied>()
  const state = { generation: 'g0', status: 's0', refreshFails: false, now: 0 }
  const host: ApplyHost = {
    bots: () => [
      { id: 'a', engineBotId: 'dev-a' },
      { id: 'b', engineBotId: 'dev-b' }
    ],
    mainChat: id => `${id}-main`,
    refresh: async () => {
      log.push('refresh')
      if (state.refreshFails) throw new Error('down')
    },
    apply: async (engineBotId, chatIds) => {
      log.push(`apply ${engineBotId} ${chatIds.join(',')}`)
      return chatIds.map(chatId => ({ chatId, state: states.get(chatId) ?? 'applied' }))
    },
    tell: async (botId, chatId, prompt, runId) => log.push(`tell ${botId} ${chatId} ${runId} ${prompt.slice(0, 30)}`)
  }
  let published = 0
  const applier = new ConnectionApplier(
    host,
    () => state.generation,
    () => state.status,
    () => published++,
    () => state.now
  )
  applier.start()
  return { applier, log, states, state, published: () => published }
}

test('nothing happens until something changes; a change is given to every bot, then applied to each main conversation', async () => {
  const f = fixture()
  await f.applier.tick()
  expect(f.log).toEqual([])
  f.state.generation = 'g1'
  f.state.status = 's1'
  await f.applier.tick()
  expect(f.log).toEqual(['refresh', 'apply dev-a a-main', 'apply dev-b b-main'])
  expect(f.published()).toBe(1)
  await f.applier.tick()
  expect(f.log).toHaveLength(3)
})

test('a conversation whose turn runs is asked again until it is idle; the sign-in notice waits for it and goes once', async () => {
  const f = fixture()
  f.states.set('a-main', 'busy')
  f.state.generation = 'g1'
  f.applier.signedIn('a', 'a-main', 'notion', 'connection-x-1')
  await f.applier.tick()
  expect(f.log).toEqual(['refresh', 'apply dev-a a-main', 'apply dev-b b-main'])
  await f.applier.tick()
  expect(f.log.at(-1)).toBe('apply dev-a a-main')
  f.states.set('a-main', 'applied')
  await f.applier.tick()
  await Bun.sleep(0)
  expect(f.log.at(-1)).toBe(`tell a a-main connection-x-1 ${connectedPrompt('notion').slice(0, 30)}`)
  await f.applier.tick()
  expect(f.log.filter(line => line.startsWith('tell'))).toHaveLength(1)
})

test('a refresh that fails is retried later, and nothing is applied before it succeeds', async () => {
  const f = fixture()
  f.state.refreshFails = true
  f.state.generation = 'g1'
  await f.applier.tick()
  await f.applier.tick()
  expect(f.log).toEqual(['refresh'])
  f.state.refreshFails = false
  f.state.now += 30_000
  await f.applier.tick()
  expect(f.log).toEqual(['refresh', 'refresh', 'apply dev-a a-main', 'apply dev-b b-main'])
})

test('a message sent the moment the turn ended waits for the change to be applied; other messages never wait', async () => {
  const f = fixture()
  f.states.set('a-main', 'busy')
  f.state.generation = 'g1'
  await f.applier.tick()
  f.states.set('a-main', 'applied')
  const before = f.log.length
  await f.applier.ready('a', 'a-main')
  expect(f.log.slice(before)).toEqual(['apply dev-a a-main'])
  await f.applier.ready('a', 'a-main')
  await f.applier.ready('b', 'b-main')
  expect(f.log.slice(before)).toHaveLength(1)
})
