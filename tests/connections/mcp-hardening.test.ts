import { afterAll, expect, test } from 'bun:test'
import { connectionKey } from '../../server/connections/connection-keys'
import { createServiceForward } from '../../server/connections/mcp-forward'
import { OUTPUT_FENCE } from '../../server/connections/mcp-forward-replies'
import { probe } from '../../server/connections/mcp-probe'
import { serviceKeyPurpose } from '../../server/connections/mcp-service-connection'
import { TokenKeeper } from '../../server/connections/mcp-token-keeper'
import { hermesMcpToolName } from '../../server/engines/hermes/hermes-connections'
import { connectionsFixture } from './connections-fixture'

const TOKEN = 'engine-token'
const PORT = 3995

let respond: (body: any, req: Request) => Response | Promise<Response> = () => Response.json({ jsonrpc: '2.0', id: 1, result: {} })
const custom = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  async fetch(req) {
    const body = req.method === 'POST' ? await req.json() : null
    return respond(body, req)
  }
})
afterAll(() => custom.stop(true))

function makeForward(tools = ['echo']) {
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
    toolNames: tools
  })
  const forward = createServiceForward({
    services: f.services,
    store: f.store,
    credentials: f.credentials,
    keeper: new TokenKeeper(f.credentials, () => f.clock.now),
    engineToken: TOKEN,
    port: PORT,
    botIds: () => [...f.bots],
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

test('L3: a transient 401 on an open service sets needs_sign_in and a subsequent 200 restores connected', async () => {
  const { f, id, send } = makeForward()
  respond = () => new Response('Unauthorized', { status: 401 })
  const failed = await (await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } })).json()
  expect(failed.result.isError).toBe(true)
  expect(f.store.get(id)?.state).toBe('needs_sign_in')

  respond = () => Response.json({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'back' }] } })
  const recovered = await (await send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'echo', arguments: {} } })).json()
  expect(recovered.result.isError).toBeUndefined()
  expect(recovered.result.content[0].text).toContain('back')
  expect(f.store.get(id)?.state).toBe('connected')
})

test('L4a: image blocks allow only PNG, JPEG, GIF and WebP (omitting SVG); audio blocks allow safe audio only', async () => {
  const { send } = makeForward()
  respond = () =>
    Response.json({
      jsonrpc: '2.0',
      id: 1,
      result: {
        content: [
          { type: 'image', mimeType: 'image/svg+xml', data: 'PHN2Zz48L3N2Zz4=' },
          { type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
          { type: 'image', mimeType: 'image/webp', data: 'UklGRg==' },
          { type: 'audio', mimeType: 'audio/mpeg', data: 'SUQz' },
          { type: 'audio', mimeType: 'audio/svg+xml', data: 'PHN2Zz4=' }
        ]
      }
    })
  const res = await (await send({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'echo', arguments: {} } })).json()
  const items = res.result.content
  expect(items).toHaveLength(8)
  expect(items[0].text).toStartWith(`<${OUTPUT_FENCE}>`)
  expect(items[0].text).toContain('Invalid image block omitted')
  expect(items[1].text).toContain('image/png')
  expect(items[2]).toEqual({ type: 'image', mimeType: 'image/png', data: 'iVBORw0KGgo=' })
  expect(items[3].text).toContain('image/webp')
  expect(items[4]).toEqual({ type: 'image', mimeType: 'image/webp', data: 'UklGRg==' })
  expect(items[5].text).toContain('audio/mpeg')
  expect(items[6]).toEqual({ type: 'audio', mimeType: 'audio/mpeg', data: 'SUQz' })
  expect(items[7].text).toContain('Invalid audio block omitted')
})

test('L4b: upstream JSON array or SSE stream with multiple JSON-RPC responses returns only the first response while keeping progress notifications', async () => {
  const { send } = makeForward()
  respond = () =>
    Response.json([
      { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p1', progress: 1, total: 2 } },
      { jsonrpc: '2.0', id: 99, result: { content: [{ type: 'text', text: 'first' }] } },
      { jsonrpc: '2.0', id: 100, result: { content: [{ type: 'text', text: 'second' }] } }
    ])
  const arr = await (await send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'echo', arguments: {} } })).json()
  expect(arr).toHaveLength(2)
  expect(arr[0]).toEqual({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p1', progress: 1, total: 2 } })
  expect(arr[1].id).toBe(7)
  expect(arr[1].result.content[0].text).toContain('first')
  expect(JSON.stringify(arr)).not.toContain('second')

  respond = () =>
    new Response(
      `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 'p2', progress: 5 } })}\n\n` +
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: 'sse-first' }] } })}\n\n` +
        `event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text: 'sse-second' }] } })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } }
    )
  const sse = await (await send({ jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'echo', arguments: {} } })).text()
  const events = sse
    .trim()
    .split('\n\n')
    .map(block => JSON.parse(block.split('data: ')[1]))
  expect(events).toHaveLength(2)
  expect(events[0].method).toBe('notifications/progress')
  expect(events[1].id).toBe(8)
  expect(events[1].result.content[0].text).toContain('sse-first')
  expect(sse).not.toContain('sse-second')
})

test('L4c: probe and McpConnections.add apply the engine toolName mapping for collision deduplication on the first pass', async () => {
  respond = body => {
    if (body?.id === undefined) return new Response(null, { status: 202 })
    if (body.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } })
    if (body.method === 'tools/list')
      return Response.json({
        jsonrpc: '2.0',
        id: body.id,
        result: { tools: [{ name: 'ReadItem' }, { name: 'readitem' }, { name: 'a-b' }, { name: 'a.b' }] }
      })
    return Response.json({ jsonrpc: '2.0', id: body.id, result: {} })
  }
  // Custom case-insensitive engine mapper deduplicates ReadItem/readitem during probe().
  const lower = await probe(new URL(`http://127.0.0.1:${custom.port}/mcp`), undefined, tool => tool.toLowerCase())
  expect(lower).toEqual({ kind: 'ok', tools: ['ReadItem', 'a-b', 'a.b'] })

  // Through McpConnections.add with hermesMcpToolName, colliding Hermes names (a-b and a.b) deduplicate on add.
  const f = connectionsFixture(undefined, false, (server, tool) => hermesMcpToolName(server, tool).toLowerCase())
  const added: any = await f.services.add('bot-a', { name: 'my_svc', address: `http://127.0.0.1:${custom.port}/mcp`, requestId: 'r-map' })
  expect(added.tools).toBe(2)
  expect(f.store.get(added.id)?.toolNames).toEqual(['ReadItem', 'a-b'])
})
