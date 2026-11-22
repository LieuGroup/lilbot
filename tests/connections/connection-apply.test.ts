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

test('applyBot queues a bot’s live main conversation for an in-place reload without a new session', async () => {
  const f = fixture()
  f.applier.applyBot('a')
  await f.applier.tick()
  expect(f.log).toEqual(['apply dev-a a-main'])
  await f.applier.tick()
  expect(f.log).toEqual(['apply dev-a a-main'])
})

test('applyBot arriving while an earlier apply is in flight replaces the entry, preserves notices, and clears retry backoff', async () => {
  const f = fixture()
  const host = (f.applier as any).host as ApplyHost
  const baseApply = host.apply
  let midApply: (() => void) | undefined
  let failOnce = false
  host.apply = async (engineBotId, chatIds) => {
    if (failOnce) {
      failOnce = false
      throw new Error('transient')
    }
    const out = await baseApply(engineBotId, chatIds)
    const hook = midApply
    midApply = undefined
    hook?.()
    return out
  }
  f.applier.signedIn('a', 'a-main', 'svc', 'run-mid-1')
  midApply = () => f.applier.applyBot('a')
  await f.applier.tick()
  await Bun.sleep(0)
  // First apply saw the entry replaced mid-flight, so notice waits for the second apply.
  expect(f.log.filter(line => line.startsWith('apply dev-a'))).toHaveLength(1)
  expect(f.log.filter(line => line.startsWith('tell'))).toEqual([])
  await f.applier.tick()
  await Bun.sleep(0)
  expect(f.log.filter(line => line.startsWith('apply dev-a'))).toHaveLength(2)
  expect(f.log.filter(line => line.startsWith('tell'))).toHaveLength(1)

  // A failed apply backs off for 30s; a fresh applyBot clears retryAt immediately.
  const before = f.log.length
  failOnce = true
  f.applier.applyBot('a')
  await f.applier.tick()
  await f.applier.tick()
  expect(f.log.slice(before)).toEqual([])
  f.applier.applyBot('a')
  await f.applier.tick()
  expect(f.log.slice(before)).toEqual(['apply dev-a a-main'])
})

test('a sign-in arriving while an earlier apply or refresh is in flight is not dropped and notifies only after its own apply', async () => {
  const f = fixture()
  let onApply: (() => void) | undefined
  let onRefresh: (() => void) | undefined
  const host = (f.applier as any).host as ApplyHost
  const baseApply = host.apply
  const baseRefresh = host.refresh
  host.apply = async (engineBotId, chatIds) => {
    const out = await baseApply(engineBotId, chatIds)
    const hook = onApply
    onApply = undefined
    hook?.()
    return out
  }
  host.refresh = async () => {
    await baseRefresh()
    const hook = onRefresh
    onRefresh = undefined
    hook?.()
  }

  // Case 1: sign-in arrives while an earlier `apply` (from `add`) is in flight.
  f.state.generation = 'g1'
  onApply = () => {
    f.state.generation = 'g2'
    f.applier.signedIn('a', 'a-main', 'oauth', 'connection-o-1')
  }
  await f.applier.tick()
  expect(f.log.filter(line => line.startsWith('tell'))).toEqual([])
  await f.applier.tick()
  await Bun.sleep(0)
  expect(f.log.filter(line => line.startsWith('tell'))).toEqual([`tell a a-main connection-o-1 ${connectedPrompt('oauth').slice(0, 30)}`])

  // Case 2: sign-in arrives while an earlier `refresh` is in flight: must refresh g4 before notifying.
  const before = f.log.length
  f.state.generation = 'g3'
  onRefresh = () => {
    f.state.generation = 'g4'
    f.applier.signedIn('a', 'a-main', 'oauth', 'connection-o-2')
  }
  await f.applier.tick()
  expect(f.log.slice(before)).toEqual(['refresh'])
  await f.applier.tick()
  await Bun.sleep(0)
  expect(f.log.slice(before)).toEqual(['refresh', 'refresh', 'apply dev-a a-main', `tell a a-main connection-o-2 ${connectedPrompt('oauth').slice(0, 30)}`, 'apply dev-b b-main'])
})
