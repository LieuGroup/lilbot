/** Targeted guard-removal tests for PR #246's four guards (ambiguity slot retirement, outside-MCP ambiguity, dropClaim, and answer/notice re-arming). */
import { afterAll, expect, test } from 'bun:test'
import { connectionKey } from '../../server/connections/connection-keys'
import { createServiceForward } from '../../server/connections/mcp-forward'
import { serviceKeyPurpose } from '../../server/connections/mcp-service-connection'
import { TokenKeeper } from '../../server/connections/mcp-token-keeper'
import { openDatabase } from '../../server/database/database'
import { serviceSessionRefusal, systemSessionRefusal } from '../../server/system/check-access'
import { AMBIGUOUS, CallingChats } from '../../server/threads/calling-chats'
import { ThreadStore } from '../../server/threads/thread-store'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import type { WebhookStore } from '../../server/webhooks/webhook-store'
import { connectionsFixture } from '../connections/connections-fixture'
import { systemFixture } from '../system/system-fixture'

let upstreamHits = 0
const upstream = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () => {
    upstreamHits++
    return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })
  }
})
afterAll(() => upstream.stop(true))

test('Guard 1: CallingChats.take retires claimed slots on gated ambiguity even when the restricted start is ordered first', async () => {
  const calls = new CallingChats(80)
  const prefer = (chat: string) => chat === 'wh-1'
  const status = { action: 'status' }
  calls.saw('b1', 'wh-1', 'mcp__lilbot_system__lilbot_delegation', status, 'c-wh')
  calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_delegation', status, 'c-main')
  expect(typeof (await calls.gate('b1', 'lilbot_delegation', status, prefer))).toBe('symbol')
  expect(typeof (await calls.gate('b1', 'lilbot_delegation', status, prefer))).toBe('symbol')
  calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_delegation', status, 'c-retry')
  expect(await calls.gate('b1', 'lilbot_delegation', status, prefer)).toBe('b1-main')
  expect(await calls.claim('b1', 'lilbot_delegation', status, prefer)).toBe('b1-main')

  calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_delegation', status, 'c-m2')
  calls.saw('b1', 'wh-1', 'mcp__lilbot_system__lilbot_delegation', status, 'c-w2')
  expect(typeof (await calls.gate('b1', 'lilbot_delegation', status, prefer))).toBe('symbol')
  expect(typeof (await calls.gate('b1', 'lilbot_delegation', status, prefer))).toBe('symbol')
  calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_delegation', status, 'c-retry2')
  expect(await calls.gate('b1', 'lilbot_delegation', status, prefer)).toBe('b1-main')
  expect(await calls.claim('b1', 'lilbot_delegation', status, prefer)).toBe('b1-main')
})

test('Guard 2: serviceSessionRefusal returns AMBIGUOUS (not generic webhook refusal or pass-through) on concurrent mixed outside-service calls', async () => {
  const f = connectionsFixture()
  const id = crypto.randomUUID()
  f.store.insert({
    id,
    name: 'svc',
    address: `http://127.0.0.1:${upstream.port}/mcp`,
    state: 'connected',
    addedBy: 'Alpha',
    addedById: 'bot-a',
    requestId: 'r-ambig',
    createdAt: f.clock.now,
    toolNames: ['echo']
  })
  const calls = new CallingChats(100)
  const webhookStore = {
    hasRuns: (b: string) => b === 'bot-a',
    runForChat: (_b: string, c: string) => (c === 'hook-chat' ? ({ capabilities: ['web'] } as any) : null)
  } as Pick<WebhookStore, 'runForChat' | 'hasRuns'>
  const callers = webhookCallers(webhookStore, (_b, c) => c, calls)
  let checking = false
  const checkSessions = { checking: (b: string) => checking && b === 'bot-a', isCheck: (_b: string, c: string) => c === 'check-chat' }
  const forward = createServiceForward({
    services: f.services,
    store: f.store,
    credentials: f.credentials,
    keeper: new TokenKeeper(f.credentials, () => f.clock.now),
    engineToken: 'engine-token',
    port: 3995,
    botIds: () => [...f.bots],
    refusal: serviceSessionRefusal(callers, checkSessions, calls)
  })
  const path = `/engine/connections/${id}/mcp`
  const send = (args: Record<string, unknown>, reqId: number) =>
    forward(
      new Request(`http://127.0.0.1:3995${path}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:3995', authorization: `Bearer ${connectionKey('engine-token', serviceKeyPurpose(id), 'bot-a')}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: reqId, method: 'tools/call', params: { name: 'echo', arguments: args } })
      }),
      path
    ).then(r => r.json())

  const before = upstreamHits
  calls.saw('bot-a', 'hook-chat', 'mcp__lilbot_c_svc__echo', { text: 'same' }, 'h1')
  calls.saw('bot-a', 'bot-a-main', 'mcp__lilbot_c_svc__echo', { text: 'same' }, 'm1')
  const r1 = await send({ text: 'same' }, 1)
  const r2 = await send({ text: 'same' }, 2)
  expect(JSON.parse(r1.result.content[0].text).refused).toBe(AMBIGUOUS)
  expect(JSON.parse(r2.result.content[0].text).refused).toBe(AMBIGUOUS)
  expect(upstreamHits).toBe(before)

  calls.saw('bot-a', 'bot-a-main', 'mcp__lilbot_c_svc__echo', { text: 'same' }, 'm2')
  const ok = await send({ text: 'same' }, 3)
  expect(ok.result.content[0].text).toContain('ok')
  expect(upstreamHits).toBe(before + 1)

  checking = true
  calls.saw('bot-a', 'check-chat', 'mcp__lilbot_c_svc__echo', { text: 'chk' }, 'ck1')
  calls.saw('bot-a', 'bot-a-main', 'mcp__lilbot_c_svc__echo', { text: 'chk' }, 'ck2')
  const c1 = await send({ text: 'chk' }, 4)
  expect(JSON.parse(c1.result.content[0].text).refused).toBe(AMBIGUOUS)
  expect(upstreamHits).toBe(before + 1)
})

test('Guard 3: dropClaim retires refused gate entries so a following takeSingle fallback in claim() still succeeds', async () => {
  const f = systemFixture()
  const calls = new CallingChats(120)
  const webhookStore = {
    hasRuns: () => true,
    runForChat: (_b: string, c: string) => (c === 'wh-chat' ? ({ capabilities: [] } as any) : null)
  } as unknown as Pick<WebhookStore, 'runForChat' | 'hasRuns'>
  const callers = webhookCallers(webhookStore, (_b, c) => c, calls)
  let checking = false
  const checkSessions = { checking: () => checking, isCheck: (_b: string, c: string) => c === 'chk-chat' }
  const refuse = systemSessionRefusal(f.tools, checkSessions, callers, calls, () => false)

  calls.saw('b1', 'wh-chat', 'mcp__lilbot_system__lilbot_delegation', { action: 'status' }, 'w-ref')
  expect(await refuse('b1', 'lilbot_delegation', { action: 'status' })).toContain('webhook run')
  calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_delegation', { action: 'status', coerced: '1' }, 'm-single-1')
  expect(await calls.claim('b1', 'lilbot_delegation', { action: 'status', coerced: 1 }, c => c === 'wh-chat')).toBe('b1-main')

  checking = true
  calls.saw('b1', 'chk-chat', 'mcp__lilbot_system__lilbot_delegation', { action: 'cancel', exchangeId: 'e1' }, 'k-ref')
  expect(await refuse('b1', 'lilbot_delegation', { action: 'cancel', exchangeId: 'e1' })).toContain('check')
  calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_delegation', { action: 'cancel', exchangeId: 'e2', extra: true }, 'm-single-2')
  expect(await calls.claim('b1', 'lilbot_delegation', { action: 'cancel', exchangeId: 'e2' }, c => c === 'chk-chat')).toBe('b1-main')
})

test('Guard 4: answer and notice deliveries re-arm activeNarrowedCaps for settled narrowed chats on zero-webhook bots', () => {
  const db = openDatabase(':memory:')
  const roots = new Map<string, string | null>()
  const rootOf = (_b: string, chat: string) => (roots.has(chat) ? roots.get(chat)! : chat)
  const store = new ThreadStore(db, rootOf)
  const [b1, b2, b3] = [
    { id: 'b1', name: 'Bot One' },
    { id: 'b2', name: 'Bot Two' },
    { id: 'b3', name: 'Bot Three' }
  ]

  const d1 = store.accept(b1, b2, { requestId: 'd1', text: 'x', chatId: 'wh-1', capabilities: ['delegation', 'memory'] })
  store.attach(d1, b2.id, 'b2-narrow', true)
  store.setStatus(d1.id, 'done')
  expect(store.activeNarrowedCaps(b2.id)).toBeNull()

  const d2 = store.accept(b2, b3, { requestId: 'd2', text: 'y', chatId: 'b2-narrow', capabilities: ['delegation', 'memory'] })
  store.setStatus(d2.id, 'done')
  store.enqueue('ans-b2', d2.threadId, b3.id, b2.id, 'b2-narrow', 'reply', 'answer')
  expect(store.activeNarrowedCaps(b2.id)).toEqual(['delegation', 'memory'])
  roots.set('b2-narrow-child', null)
  store.enqueue('ans-b2-unreadable', d2.threadId, b3.id, b2.id, 'b2-narrow-child', 'reply', 'answer')
  expect(store.activeNarrowedCaps(b2.id)).toEqual([])
  store.setStatus('ans-b2', 'done')
  store.setStatus('ans-b2-unreadable', 'done')
  expect(store.activeNarrowedCaps(b2.id)).toBeNull()

  store.enqueue('not-b2', d2.threadId, b2.id, b2.id, 'b2-narrow', 'group ended', 'notice')
  expect(store.activeNarrowedCaps(b2.id)).toEqual(['delegation', 'memory'])
  store.setStatus('not-b2', 'done')
  expect(store.activeNarrowedCaps(b2.id)).toBeNull()
  db.close()
})
