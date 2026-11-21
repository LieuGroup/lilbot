import { afterAll, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectionKey } from '../../server/connections/connection-keys'
import { createT3Bridge } from '../../server/connections/t3-bridge'
import { scopedRequestId } from '../../server/connections/t3-bridge-replies'
import { T3_KEY_PURPOSE, T3_STATUS_TOOL } from '../../server/connections/t3-connection'
import { T3Grants } from '../../server/connections/t3-grant'

const TOKEN = 'engine-token-for-tests'
const PORT = 3999
const dir = mkdtempSync(join(tmpdir(), 'lilbot-bridge-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** What T3 Code received, and how it answers next. */
let received: { method: string; headers: Headers; body: any }[] = []
let answer: (body: any) => Response = () => new Response(null, { status: 202 })
const upstream = (async (_url: string | URL | Request, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  received.push({ method: String(init?.method), headers: new Headers(init?.headers), body })
  return answer(body)
}) as typeof fetch

let grants: T3Grants
let bots = ['bot-a', 'bot-b']
let bridge: ReturnType<typeof createT3Bridge>
beforeEach(() => {
  received = []
  bots = ['bot-a', 'bot-b']
  grants = new T3Grants(join(dir, `${crypto.randomUUID()}.json`))
  bridge = createT3Bridge({ upstream: 'http://t3.test/mcp', grants, engineToken: TOKEN, port: PORT, botIds: () => bots, refusal: async () => null, fetch: upstream })
})
const signIn = () => grants.save({ accessToken: 'the-grant', expiresAt: Date.now() + 86_400_000, issuedAt: Date.now(), scope: '', label: 'LilBot' })

function post(message: unknown, bot = 'bot-a', headers: Record<string, string> = {}) {
  return bridge(
    new Request(`http://127.0.0.1:${PORT}/engine/t3/mcp`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${connectionKey(TOKEN, T3_KEY_PURPOSE, bot)}`, 'content-type': 'application/json', ...headers },
      body: JSON.stringify(message)
    })
  )
}
const call = (name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } })

test('only engine processes on this machine with a current bot’s own key get in', async () => {
  expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'bot-a', { origin: 'http://evil.test' })).status).toBe(403)
  expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'bot-a', { host: 'lilbot.tailnet:8443' })).status).toBe(403)
  expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'someone-else')).status).toBe(403)
  bots = ['bot-b']
  expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'bot-a')).status).toBe(403)
  expect((await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'bot-b')).status).toBe(200)
})

test('signed out, the bot gets one status tool whose answer says how to renew; T3 is never called', async () => {
  const init = await (await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json()
  expect(init.result.protocolVersion).toBe('2025-06-18')
  const list = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()
  expect(list.result.tools.map((tool: any) => tool.name)).toEqual([T3_STATUS_TOOL])
  const result = await (await post(call('t3_thread_launch', { title: 'x' }))).json()
  expect(result.result.isError).toBe(true)
  expect(result.result.content[0].text).toContain('not signed in to T3 Code')
  expect((await post({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202)
  expect(received).toEqual([])
})

test('signed in, requests go to T3 with LilBot’s grant and never with the bot’s key', async () => {
  signIn()
  answer = () => Response.json({ jsonrpc: '2.0', id: 1, result: {} }, { headers: { 'mcp-session-id': 'session-1' } })
  const response = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, 'bot-a', {
    'mcp-protocol-version': '2025-06-18',
    accept: 'application/json, text/event-stream'
  })
  expect(response.headers.get('mcp-session-id')).toBe('session-1')
  expect(received[0].headers.get('authorization')).toBe('Bearer the-grant')
  expect(received[0].headers.get('mcp-protocol-version')).toBe('2025-06-18')
  expect(received[0].headers.get('accept')).toBe('application/json, text/event-stream')
})

test('tool lists are narrowed to the coding tools, as JSON and as an event stream', async () => {
  signIn()
  const tools = [{ name: 't3_thread_launch' }, { name: 't3_project_delete' }, { name: 't3_theme_set' }]
  answer = () => Response.json({ jsonrpc: '2.0', id: 2, result: { tools } })
  expect((await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools).toEqual([{ name: 't3_thread_launch' }])
  answer = () => new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  const stream = await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).text()
  expect(JSON.parse(stream.split('\n')[1].slice(5)).result.tools).toEqual([{ name: 't3_thread_launch' }])
})

test('tools outside the list are refused without reaching T3', async () => {
  signIn()
  const result = await (await post(call('t3_project_delete', { projectId: 'p', force: true }))).json()
  expect(result.result.isError).toBe(true)
  expect(received).toEqual([])
})

test('retry keys are kept apart per bot and stay stable, so a retry still finds its thread', async () => {
  signIn()
  answer = body => Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [] } })
  await post(call('t3_thread_launch', { title: 'x', clientRequestId: 'task-1' }), 'bot-a')
  await post(call('t3_thread_launch', { title: 'x', clientRequestId: 'task-1' }), 'bot-a')
  await post(call('t3_thread_launch', { title: 'x', clientRequestId: 'task-1' }), 'bot-b')
  const ids = received.map(r => r.body.params.arguments.clientRequestId)
  expect(ids).toEqual(['lilbot:bot-a:task-1', 'lilbot:bot-a:task-1', 'lilbot:bot-b:task-1'])
  const long = scopedRequestId('bot-a', 'x'.repeat(300))
  expect(long.length).toBeLessThanOrEqual(256)
  expect(long).toBe(scopedRequestId('bot-a', 'x'.repeat(300)))
})

test('when T3 refuses the grant, it is marked revoked and the bot is told how to renew, not asked to sign in itself', async () => {
  signIn()
  answer = () => Response.json({ error: 'invalid_mcp_credential' }, { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="x"' } })
  const response = await post(call('t3_thread_read', { threadId: 't' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('www-authenticate')).toBeNull()
  expect((await response.json()).result.content[0].text).toContain('revoked')
  expect(grants.status().state).toBe('revoked')
})

test('an unreachable T3 Code is a tool error, and the status tool confirms a working sign-in', async () => {
  signIn()
  bridge = createT3Bridge({
    upstream: 'http://t3.test/mcp',
    grants,
    engineToken: TOKEN,
    port: PORT,
    botIds: () => bots,
    refusal: async () => null,
    fetch: (async () => {
      throw new Error('connection refused')
    }) as unknown as typeof fetch
  })
  expect((await (await post(call('t3_thread_read', { threadId: 't' }))).json()).result.content[0].text).toContain('not reachable')
  expect((await (await post(call(T3_STATUS_TOOL))).json()).result.content[0].text).toContain('signed in to T3 Code until')
})

test('a single passing refusal does not revoke the sign-in', async () => {
  signIn()
  let refusals = 1
  answer = body => (refusals-- > 0 ? Response.json({}, { status: 401 }) : Response.json({ jsonrpc: '2.0', id: body.id, result: {} }))
  const result = await (await post(call('t3_thread_read', { threadId: 't' }))).json()
  expect(result.result.content[0].text).toContain('Try again')
  expect(grants.status().state).toBe('connected')
})

test('a call the session may not make (a webhook run without coding) is refused before T3 is called', async () => {
  signIn()
  bridge = createT3Bridge({
    upstream: 'http://t3.test/mcp',
    grants,
    engineToken: TOKEN,
    port: PORT,
    botIds: () => bots,
    refusal: async (bot, tool) => (bot === 'bot-a' && tool === 't3_thread_launch' ? 'A webhook run cannot use t3_thread_launch.' : null),
    fetch: upstream
  })
  const result = await (await post(call('t3_thread_launch', { title: 'x' }))).json()
  expect(result.result).toEqual({ content: [{ type: 'text', text: 'A webhook run cannot use t3_thread_launch.' }], isError: true })
  expect(received).toEqual([])
})
