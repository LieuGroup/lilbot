/** Targeted guard tests for unified caller-limitation placement and idle-peek / read-only / check-verdict invariants. */
import { afterAll, expect, spyOn, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { connectionKey } from '../../server/connections/connection-keys'
import { createServiceForward } from '../../server/connections/mcp-forward'
import { serviceKeyPurpose } from '../../server/connections/mcp-service-connection'
import { TokenKeeper } from '../../server/connections/mcp-token-keeper'
import { openDatabase } from '../../server/database/database'
import { serviceSessionRefusal, systemSessionRefusal } from '../../server/system/check-access'
import { AMBIGUOUS, CallingChats } from '../../server/threads/calling-chats'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import { WebhookService } from '../../server/webhooks/webhook-service'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { connectionsFixture } from '../connections/connections-fixture'
import { systemFixture } from '../system/system-fixture'
import { check, finish, fixture as workFixture } from '../work/work-check-fixture'

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

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...tsFiles(full))
    else if (full.endsWith('.ts')) out.push(full)
  }
  return out
}

test('Item 1 bypass guard: only webhook-callers.ts calls CallingChats.gate/peek/claim or live-vs-idle caller checks', () => {
  const root = join(import.meta.dir, '../../server')
  for (const file of tsFiles(root)) {
    const rel = file.slice(root.length + 1).replaceAll('\\', '/')
    const text = readFileSync(file, 'utf8')
    if (rel !== 'webhooks/webhook-callers.ts' && rel !== 'threads/calling-chats.ts') {
      if (text.includes('calling-chats') || text.includes('CallingChats')) {
        expect(text, `${rel} must route through webhookCallers.placeCall/forCall/forAction instead of CallingChats.gate/peek/claim`).not.toMatch(/\bcalls\.(gate|peek|claim)\(/)
      }
      expect(text, `${rel} must not define a duplicate narrowedCaller helper`).not.toMatch(/\bfunction\s+narrowedCaller\b/)
    }
    if (rel !== 'webhooks/webhook-callers.ts' && rel !== 'webhooks/webhook-store.ts') {
      expect(text, `${rel} must not call activeRunCaps directly`).not.toMatch(/\.activeRunCaps\(/)
    }
    if (rel !== 'webhooks/webhook-callers.ts' && rel !== 'threads/thread-store.ts' && rel !== 'threads/thread-accept.ts') {
      expect(text, `${rel} must not call activeNarrowedCaps directly`).not.toMatch(/\.activeNarrowedCaps\(/)
    }
    if (rel !== 'webhooks/webhook-callers.ts') {
      expect(text, `${rel} must not branch on callers.hasRuns/hasHistory directly`).not.toMatch(/\bcallers\??\.(hasRuns|hasHistory)\b/)
    }
  }
})

test('Guard 5a: WorkChecks.verdict rejects non-check sessions at the early !callerCheck guard even on settled items', async () => {
  const f = workFixture()
  const item = await finish(f)
  await check(f, item.id, 'verified')
  f.state.chats.set('b', 'b-main')
  await expect(f.work.act('b', { requestId: `v-${item.id}:check:1`, itemId: item.id, verdict: 'verified', result: 'x' })).rejects.toThrow(/Give the verdict from the check session/)
})

test('Guard 5b: WebhookService.openRun wraps send as read-only even when host.openChat allows send', async () => {
  const db = openDatabase(':memory:')
  db.query("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES ('b1', 'B1', '', '', 'test', 'n1')").run()
  const store = new WebhookStore(db)
  const hook = store.create('b1', { requestId: 'h-open', description: 'H', source: 'GH', createdBy: 'oscar' }, null, 1)
  db.query("INSERT INTO webhook_runs (id, webhook_id, bot_id, created_at, status) VALUES ('r-open', ?, 'b1', 1, 'completed')").run(hook.id)
  store.attach('r-open', 'wh-open', 2)
  store.finish('r-open', 'completed', 'ok', 3)
  let hostSent = 0
  const svc = new WebhookService(
    store,
    {
      requireBot: async () => ({}),
      runRoutine: async () => ({ status: 'completed', text: 'ok' }),
      openChat: async () => ({
        snapshot: { chatId: 'wh-open', botId: 'b1', title: 'Run', workspace: '/tmp', items: [], running: false },
        send: async () => {
          hostSent++
        },
        stop: async () => {},
        close: () => {}
      })
    },
    'key',
    'https://h.example'
  )
  const chat = await svc.openRun('b1', 'r-open', () => {})
  await expect(chat.send('continue')).rejects.toThrow(/cannot be continued/)
  expect(hostSent).toBe(0)
  db.close()
})

test('Guards 5c, 5d, 5e: idle peek enforces settled sessions on outside MCP, system dropClaim, and T3 forCall', async () => {
  const f = connectionsFixture()
  const id = crypto.randomUUID()
  f.store.insert({
    id,
    name: 'svc',
    address: `http://127.0.0.1:${upstream.port}/mcp`,
    state: 'connected',
    addedBy: 'A',
    addedById: 'bot-a',
    requestId: 'r1',
    createdAt: f.clock.now,
    toolNames: ['echo']
  })
  const calls = new CallingChats(100)
  const settledStore = {
    hasRuns: (b: string) => b === 'bot-a' || b === 'b1',
    activeRunCaps: () => [],
    runForChat: (_b: string, c: string) => (c === 'hook-chat' ? ({ capabilities: [] } as any) : null)
  } as unknown as Pick<WebhookStore, 'runForChat' | 'hasRuns' | 'activeRunCaps'>
  const callers = webhookCallers(settledStore, (_b, c) => c, calls)
  const noCheck = { checking: () => false, isCheck: () => false }
  const forward = createServiceForward({
    services: f.services,
    store: f.store,
    credentials: f.credentials,
    keeper: new TokenKeeper(f.credentials, () => f.clock.now),
    engineToken: 'engine-token',
    port: 3994,
    botIds: () => [...f.bots],
    refusal: serviceSessionRefusal(callers, noCheck)
  })
  const path = `/engine/connections/${id}/mcp`
  const send = (args: Record<string, unknown>, reqId: number) =>
    forward(
      new Request(`http://127.0.0.1:3994${path}`, {
        method: 'POST',
        headers: { host: '127.0.0.1:3994', authorization: `Bearer ${connectionKey('engine-token', serviceKeyPurpose(id), 'bot-a')}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: reqId, method: 'tools/call', params: { name: 'echo', arguments: args } })
      }),
      path
    ).then(r => r.json())
  const before = upstreamHits
  // 5c: outside MCP idle peek refuses settled hook-chat and mixed ambiguity; unmatched passes in 0ms.
  calls.saw('bot-a', 'hook-chat', 'mcp__lilbot_c_svc__echo', { text: 's1' }, 'c-5c-1')
  expect(JSON.parse((await send({ text: 's1' }, 1)).result.content[0].text).refused).toContain('webhook run')
  calls.saw('bot-a', 'hook-chat', 'mcp__lilbot_c_svc__echo', { text: 'mix' }, 'c-5c-2')
  calls.saw('bot-a', 'bot-a-main', 'mcp__lilbot_c_svc__echo', { text: 'mix' }, 'c-5c-3')
  expect(JSON.parse((await send({ text: 'mix' }, 2)).result.content[0].text).refused).toBe(AMBIGUOUS)
  expect(upstreamHits).toBe(before)
  const slept = spyOn(Bun, 'sleep')
  try {
    expect((await send({ text: 'idle-ok' }, 3)).result.content[0].text).toContain('ok')
    expect(upstreamHits).toBe(before + 1)
    // 5e: webhookCallers.forCall (T3) idle peek refuses settled start and mixed starts, passes unmatched in 0ms.
    calls.saw('b1', 'hook-chat', 'mcp__lilbot_t3__t3_exec', { cmd: 'ls' }, 'c-5e-1')
    expect(await callers.forCall('b1', 't3_exec', { cmd: 'ls' })).toEqual([])
    calls.saw('b1', 'hook-chat', 'mcp__lilbot_t3__t3_exec', { cmd: 'pwd' }, 'c-5e-2')
    calls.saw('b1', 'b1-main', 'mcp__lilbot_t3__t3_exec', { cmd: 'pwd' }, 'c-5e-3')
    expect(await callers.forCall('b1', 't3_exec', { cmd: 'pwd' })).toEqual([])
    expect(await callers.forCall('b1', 't3_exec', { cmd: 'unmatched' })).toBeNull()
    expect(slept).not.toHaveBeenCalled()
  } finally {
    slept.mockRestore()
  }
  // 5d: dropClaim on idle peek refusal in systemSessionRefusal retires claimed slot so next takeSingle claim succeeds.
  const sys = systemFixture()
  const refuse = systemSessionRefusal(sys.tools, noCheck, callers, calls, () => false)
  calls.saw('b1', 'hook-chat', 'mcp__lilbot_system__lilbot_delegation', { action: 'status' }, 'c-5d-ref')
  expect(await refuse('b1', 'lilbot_delegation', { action: 'status' })).toContain('webhook run')
  calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_delegation', { action: 'status', coerced: '1' }, 'c-5d-main')
  expect(await calls.claim('b1', 'lilbot_delegation', { action: 'status', coerced: 1 }, c => c === 'hook-chat')).toBe('b1-main')
})
