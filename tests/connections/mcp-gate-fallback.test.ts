import { afterAll, expect, test } from 'bun:test'
import { connectionKey } from '../../server/connections/connection-keys'
import { createServiceForward } from '../../server/connections/mcp-forward'
import { serviceKeyPurpose } from '../../server/connections/mcp-service-connection'
import { TokenKeeper } from '../../server/connections/mcp-token-keeper'
import { serviceSessionRefusal } from '../../server/system/check-access'
import { CallingChats } from '../../server/threads/calling-chats'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import type { WebhookStore } from '../../server/webhooks/webhook-store'
import { connectionsFixture } from './connections-fixture'

const TOKEN = 'engine-token'
const PORT = 3996
const TOOL = 'mcp__lilbot_c_svc__echo'

let hitUpstream = 0
const upstream = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: () => {
    hitUpstream++
    return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })
  }
})
afterAll(() => upstream.stop(true))

function makeGate(waitMs = 120, opts: { hasRuns?: boolean; checking?: boolean } = {}) {
  const f = connectionsFixture()
  const id = crypto.randomUUID()
  f.store.insert({
    id,
    name: 'svc',
    address: `http://127.0.0.1:${upstream.port}/mcp`,
    state: 'connected',
    addedBy: 'Alpha',
    addedById: 'bot-a',
    requestId: 'r-init',
    createdAt: f.clock.now,
    toolNames: ['echo']
  })
  const calls = new CallingChats(waitMs)
  const webhookStore = {
    hasRuns: (b: string) => (opts.hasRuns ?? true) && b === 'bot-a',
    runForChat: (_b: string, c: string) => (c === 'hook-chat' ? ({ capabilities: ['web'] } as any) : null)
  } as Pick<WebhookStore, 'runForChat' | 'hasRuns'>
  const callers = webhookCallers(webhookStore, (_b, c) => c, calls)
  const checkSessions = { checking: (b: string) => (opts.checking ?? true) && b === 'bot-a', isCheck: (_b: string, c: string) => c === 'check-chat' }
  const forward = createServiceForward({
    services: f.services,
    store: f.store,
    credentials: f.credentials,
    keeper: new TokenKeeper(f.credentials, () => f.clock.now),
    engineToken: TOKEN,
    port: PORT,
    botIds: () => [...f.bots],
    refusal: serviceSessionRefusal(callers, checkSessions, calls)
  })
  const path = `/engine/connections/${id}/mcp`
  const call = async (args: Record<string, unknown>, reqId = 1) =>
    (
      await forward(
        new Request(`http://127.0.0.1:${PORT}${path}`, {
          method: 'POST',
          headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${connectionKey(TOKEN, serviceKeyPurpose(id), 'bot-a')}` },
          body: JSON.stringify({ jsonrpc: '2.0', id: reqId, method: 'tools/call', params: { name: 'echo', arguments: args } })
        }),
        path
      )
    ).json()
  return { calls, callers, checkSessions, call }
}

test('L2: coerced types, renamed keys and >64 KiB truncated args from main chat pass via single-unmatched-start fallback', async () => {
  const { calls, call } = makeGate(120)
  // Type coercion: model sent "10", MCP received 10.
  calls.saw('bot-a', 'bot-a-main', TOOL, { limit: '10' }, 'c-coerce')
  const coerced = await call({ limit: 10 }, 1)
  expect(coerced.result.content[0].text).toContain('ok')

  // Renamed key: model sent query, schema renamed to q.
  calls.saw('bot-a', 'bot-a-main', TOOL, { query: 'notes' }, 'c-rename')
  const renamed = await call({ q: 'notes' }, 2)
  expect(renamed.result.content[0].text).toContain('ok')

  // >64 KiB argument truncated in tool.start event.
  const full = 'x'.repeat(70_000)
  calls.saw('bot-a', 'bot-a-main', TOOL, { body: full.slice(0, 65_536) }, 'c-big')
  const big = await call({ body: full }, 3)
  expect(big.result.content[0].text).toContain('ok')
})

test('L2 fail-closed: zero starts are refused; tools with requestId never use fallback', async () => {
  const before = hitUpstream
  const { calls, call } = makeGate(100)
  const zero = await call({ q: 'ghost' }, 1)
  expect(JSON.parse(zero.result.content[0].text).refused).toContain('webhook run')
  expect(hitUpstream).toBe(before)

  // Check-only gate with zero starts also fails closed.
  const checkOnly = makeGate(100, { hasRuns: false, checking: true })
  const zeroCheck = await checkOnly.call({ q: 'ghost' }, 2)
  expect(JSON.parse(zeroCheck.result.content[0].text).refused).toContain('Make the same call again')
  expect(hitUpstream).toBe(before)

  // Call carrying requestId refuses even if one unrelated unmatched start exists.
  calls.saw('bot-a', 'bot-a-main', TOOL, { requestId: 'other-req' }, 'c-req')
  const wrongReq = await call({ requestId: 'my-req' }, 3)
  expect(JSON.parse(wrongReq.result.content[0].text).refused).toContain('webhook run')
  expect(hitUpstream).toBe(before)
})

test('L2 fail-closed: two unmatched starts (webhook + main, or two ambiguous starts) are refused', async () => {
  const before = hitUpstream
  const { calls, call } = makeGate(100)
  calls.saw('bot-a', 'bot-a-main', TOOL, { q: 'oscar' }, 'c-m1')
  calls.saw('bot-a', 'hook-chat', TOOL, { q: 'evil' }, 'c-h1')
  const ambig = await call({ q: 'coerced' }, 1)
  expect(JSON.parse(ambig.result.content[0].text).refused).toContain('webhook run')
  expect(hitUpstream).toBe(before)

  const checkOnly = makeGate(100, { hasRuns: false, checking: true })
  checkOnly.calls.saw('bot-a', 'bot-a-main', TOOL, { q: 'a' }, 'c-a')
  checkOnly.calls.saw('bot-a', 'bot-a-main', TOOL, { q: 'b' }, 'c-b')
  const ambigCheck = await checkOnly.call({ q: 'c' }, 2)
  expect(JSON.parse(ambigCheck.result.content[0].text).refused).toContain('Make the same call again')
  expect(hitUpstream).toBe(before)
})

test('L2 race protection: late webhook or check start during grace window is refused and never misattributed to main chat', async () => {
  const { calls, call } = makeGate(200, { hasRuns: true, checking: false })
  const before = hitUpstream
  // Main chat already reported its tool.start; webhook call arrives before its own tool.start.
  calls.saw('bot-a', 'bot-a-main', TOOL, { q: 'oscar' }, 'c-main')
  const hookPromise = call({ q: 'evil' }, 1)
  setTimeout(() => calls.saw('bot-a', 'hook-chat', TOOL, { q: 'evil' }, 'c-hook'), 35)
  const hookRes = await hookPromise
  expect(JSON.parse(hookRes.result.content[0].text).refused).toContain('webhook run')
  expect(hitUpstream).toBe(before)
  // Main chat's own call still matches its untouched start and succeeds.
  const mainRes = await call({ q: 'oscar' }, 2)
  expect(mainRes.result.content[0].text).toContain('ok')
  expect(hitUpstream).toBe(before + 1)

  // Same race against check session.
  const checkOnly = makeGate(200, { hasRuns: false, checking: true })
  checkOnly.calls.saw('bot-a', 'bot-a-main', TOOL, { q: 'oscar' }, 'c-main-2')
  const checkPromise = checkOnly.call({ q: 'check-probe' }, 3)
  setTimeout(() => checkOnly.calls.saw('bot-a', 'check-chat', TOOL, { q: 'check-probe' }, 'c-check'), 35)
  const checkRes = await checkPromise
  expect(JSON.parse(checkRes.result.content[0].text).refused).toContain('check')
  expect(hitUpstream).toBe(before + 1)
})

test('L2 fail-closed: single unmatched start from a webhook run or check session is refused; unreported call cannot steal a later main start', async () => {
  const before = hitUpstream
  const { calls, call } = makeGate(120)
  calls.saw('bot-a', 'hook-chat', TOOL, { limit: '10' }, 'c-h-coerced')
  const hookCoerced = await call({ limit: 10 }, 1)
  expect(JSON.parse(hookCoerced.result.content[0].text).refused).toContain('webhook run')

  calls.saw('bot-a', 'check-chat', TOOL, { limit: '10' }, 'c-k-coerced')
  const checkCoerced = await call({ limit: 10 }, 2)
  expect(JSON.parse(checkCoerced.result.content[0].text).refused).toContain('check')
  expect(hitUpstream).toBe(before)

  // Unreported call waits past graceMs; a fresh main-chat start arrives and is claimed by main chat before settle completes.
  const ghost = makeGate(200, { hasRuns: true, checking: false })
  const ghostCall = ghost.call({ q: 'ghost' }, 3)
  setTimeout(() => {
    ghost.calls.saw('bot-a', 'bot-a-main', TOOL, { q: 'legit' }, 'c-later')
    void ghost.call({ q: 'legit' }, 4)
  }, 110)
  const ghostRes = await ghostCall
  expect(JSON.parse(ghostRes.result.content[0].text).refused).toContain('webhook run')
})
