import { afterAll, expect, test } from 'bun:test'
import { connectionKey } from '../../server/connections/connection-keys'
import { createServiceForward } from '../../server/connections/mcp-forward'
import { serviceKeyPurpose } from '../../server/connections/mcp-service-connection'
import { TokenKeeper } from '../../server/connections/mcp-token-keeper'
import { checkToolRefusal } from '../../server/system/check-access'
import { refusalFor } from '../../server/system/run-access'
import { CallingChats } from '../../server/threads/calling-chats'
import { webhookCallers } from '../../server/webhooks/webhook-callers'
import type { WebhookStore } from '../../server/webhooks/webhook-store'
import { connectionsFixture } from './connections-fixture'

const TOKEN = 'engine-token'
const PORT = 3997

let respond: () => Response = () => Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })
const custom = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => respond() })
afterAll(() => custom.stop(true))

function makeForward(opts: { refusal?: (botId: string, tool: string, args: unknown) => Promise<string | null>; signed?: boolean } = {}) {
  const f = connectionsFixture()
  const id = crypto.randomUUID()
  f.store.insert({
    id,
    name: 'svc',
    address: `http://127.0.0.1:${custom.port}/mcp`,
    state: 'connected',
    addedBy: 'Alpha',
    addedById: 'bot-a',
    requestId: 'r-init',
    createdAt: f.clock.now,
    toolNames: ['echo']
  })
  if (opts.signed) {
    f.credentials.set(id, {
      server: {
        issuer: 'http://127.0.0.1',
        authorizationEndpoint: 'http://127.0.0.1/a',
        tokenEndpoint: 'http://127.0.0.1/t',
        resource: 'http://127.0.0.1/mcp',
        issRequired: false
      },
      client: { clientId: 'c1', authMethod: 'none' },
      tokens: { accessToken: 'tok-old', expiresAt: null }
    })
  }
  const forward = createServiceForward({
    services: f.services,
    store: f.store,
    credentials: f.credentials,
    keeper: new TokenKeeper(f.credentials, () => f.clock.now),
    engineToken: TOKEN,
    port: PORT,
    botIds: () => [...f.bots],
    refusal: opts.refusal,
    now: () => f.clock.now
  })
  const path = `/engine/connections/${id}/mcp`
  const send = (message: unknown) =>
    forward(
      new Request(`http://127.0.0.1:${PORT}${path}`, {
        method: 'POST',
        headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${connectionKey(TOKEN, serviceKeyPurpose(id), 'bot-a')}` },
        body: JSON.stringify(message)
      }),
      path
    )
  return { f, id, send }
}

test('Low #2: defence-in-depth session gate refuses webhook runs and check sessions while allowing normal chats', async () => {
  const calls = new CallingChats(100)
  let hitUpstream = 0
  respond = () => {
    hitUpstream++
    return Response.json({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'ok' }] } })
  }
  let checking = false
  const webhookStore = { hasRuns: (b: string) => b === 'bot-a', runForChat: (_b: string, c: string) => (c === 'hook-chat' ? ({ capabilities: ['web'] } as any) : null) } as Pick<
    WebhookStore,
    'runForChat' | 'hasRuns'
  >
  const callers = webhookCallers(webhookStore, (_b, c) => c, calls)
  const checkSessions = { checking: (b: string) => checking && b === 'bot-a', isCheck: (_b: string, c: string) => c === 'check-chat' }
  const { send } = makeForward({
    refusal: async (botId, tool, args) => refusalFor(await callers.forCall(botId, tool, args), tool, []) ?? checkToolRefusal(checkSessions, calls, botId, tool, args)
  })
  calls.saw('bot-a', 'hook-chat', 'mcp__lilbot_c_svc__echo', { text: 'w' }, 'c1')
  const hookRes = await (await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: { text: 'w' } } })).json()
  expect(JSON.parse(hookRes.result.content[0].text).refused).toContain('webhook run')
  expect(hitUpstream).toBe(0)

  checking = true
  calls.saw('bot-a', 'bot-a-main', 'mcp__lilbot_c_svc__echo', { text: 'm' }, 'c2')
  const mainRes = await (await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: { text: 'm' } } })).json()
  expect(mainRes.result.content[0].text).toContain('ok')
  expect(hitUpstream).toBe(1)

  calls.saw('bot-a', 'check-chat', 'mcp__lilbot_c_svc__echo', { text: 'k' }, 'c3')
  const checkRes = await (await send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'k' } } })).json()
  expect(JSON.parse(checkRes.result.content[0].text).refused).toContain('check')
  expect(hitUpstream).toBe(1)
})

test('Low #8: a 401 on an old token does not wipe tokens from a concurrent fresh sign-in', async () => {
  const { f, id, send } = makeForward({ signed: true })
  let calls = 0
  respond = () => {
    calls++
    const current = f.credentials.get(id)!
    f.credentials.set(id, { ...current, tokens: { accessToken: calls === 1 ? 'tok-fresh' : 'tok-newest', expiresAt: null }, signedInAt: f.clock.now })
    return new Response('Unauthorized', { status: 401 })
  }
  await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } })
  expect(f.credentials.get(id)?.tokens?.accessToken).toBe('tok-newest')
  expect(f.store.get(id)?.state).toBe('connected')
})
