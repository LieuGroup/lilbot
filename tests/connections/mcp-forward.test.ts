import { afterAll, expect, test } from 'bun:test'
import { connectionKey } from '../../server/connections/connection-keys'
import { createServiceForward } from '../../server/connections/mcp-forward'
import { OUTPUT_FENCE } from '../../server/connections/mcp-forward-replies'
import { serviceKeyPurpose } from '../../server/connections/mcp-service-connection'
import { TokenKeeper } from '../../server/connections/mcp-token-keeper'
import { connectionsFixture } from './connections-fixture'
import { serviceFixture } from './service-fixture'

const TOKEN = 'engine-token'
const PORT = 3999
const oauth = serviceFixture({ oauth: true, marker: 'SIGNED-' })
afterAll(() => oauth.stop())

async function setup(service = oauth, signIn = true) {
  const f = connectionsFixture()
  const added: any = await f.services.add('bot-a', { name: 'svc', address: service.address, requestId: crypto.randomUUID() })
  if (signIn && added.signInLink) await f.callback(await f.browse(added.signInLink))
  const forward = createServiceForward({
    services: f.services,
    store: f.store,
    credentials: f.credentials,
    keeper: new TokenKeeper(f.credentials),
    engineToken: TOKEN,
    port: PORT,
    botIds: () => [...f.bots]
  })
  const path = `/engine/connections/${added.id}/mcp`
  const send = (message: unknown, headers: Record<string, string> = {}, method = 'POST', botId = 'bot-b') =>
    forward(
      new Request(`http://127.0.0.1:${PORT}${path}?v=1`, {
        method,
        headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${connectionKey(TOKEN, serviceKeyPurpose(added.id), botId)}`, ...headers },
        body: method === 'POST' ? JSON.stringify(message) : undefined
      }),
      path
    )
  const call = async (name = oauth.tool) => (await (await send({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: { text: 'hi' } } })).json()).result
  return { f, id: added.id as string, path, forward, send, call }
}

test('only an engine on this machine with a current bot’s key for this very service gets through, and only by POST', async () => {
  const { f, id, send, forward } = await setup()
  const ping = { jsonrpc: '2.0', id: 1, method: 'ping' }
  expect((await send(ping, { origin: 'http://127.0.0.1:3999' })).status).toBe(403)
  expect((await send(ping, { host: 'evil.example' })).status).toBe(403)
  expect((await send(ping, { authorization: `Bearer ${connectionKey(TOKEN, serviceKeyPurpose('another'), 'bot-b')}` })).status).toBe(403)
  expect((await send(ping, {}, 'GET')).status).toBe(405)
  f.bots.delete('bot-b')
  expect((await send(ping)).status).toBe(403)
  const other = `/engine/connections/${crypto.randomUUID()}/mcp`
  const unknown = await forward(new Request(`http://127.0.0.1:${PORT}${other}`, { method: 'POST', headers: { host: `127.0.0.1:${PORT}` }, body: '{}' }), other)
  expect(unknown.status).toBe(403)
  expect(id).toBeTruthy()
})

test('a signed-in call carries the service token, comes back fenced as outside data, and only listed tools pass', async () => {
  const { call, send } = await setup()
  const result = await call()
  expect(result.isError).toBeUndefined()
  expect(result.content[0].text).toStartWith(`<${OUTPUT_FENCE}>`)
  expect(result.content[0].text).toContain('SIGNED-hi')
  const refused = await call('delete_everything')
  expect(refused.isError).toBe(true)
  const listed = (await (await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()).result.tools
  expect(listed.map((tool: any) => tool.name)).toEqual([oauth.tool])
})

test('before a sign-in the route answers with its status tool and never with a 401', async () => {
  const { send, call, id } = await setup(oauth, false)
  const listed = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  expect(listed.status).toBe(200)
  expect((await listed.json()).result.tools.map((tool: any) => tool.name)).toEqual(['connection_status'])
  const result = await call()
  expect(result.isError).toBe(true)
  expect(result.content[0].text).toContain(`action sign_in and id ${id}`)
})

test('an expired access token is refreshed once; a refused refresh leaves the service sign_in_expired and the status tool, never a 401', async () => {
  const { f, id, call } = await setup()
  const before = oauth.counts.refreshGrants
  oauth.expireAccess()
  expect((await call()).content[0].text).toContain('SIGNED-hi')
  expect(oauth.counts.refreshGrants).toBe(before + 1)
  expect(f.store.get(id)?.state).toBe('connected')

  oauth.revoke()
  const refused = await call()
  expect(refused.isError).toBe(true)
  expect(refused.content[0].text).toContain('expired or was refused')
  expect(f.store.get(id)?.state).toBe('sign_in_expired')
  expect(f.credentials.get(id)?.tokens).toBeUndefined()
  expect(f.services.usable(id)).toBe(false)
})

test('a service that stops answering is unreachable, holds nothing up, and is connected again when it answers', async () => {
  const flaky = serviceFixture({ oauth: false, marker: 'FLAKY-' })
  const port = flaky.server.port
  const { f, id, call } = await setup(flaky)
  expect((await call(flaky.tool)).content[0].text).toContain('FLAKY-hi')
  flaky.stop()
  const started = Date.now()
  const down = await call(flaky.tool)
  expect(Date.now() - started).toBeLessThan(5_000)
  expect(down.isError).toBe(true)
  expect(f.store.get(id)?.state).toBe('unreachable')
  const back = serviceFixture({ oauth: false, marker: 'FLAKY-', port })
  try {
    expect((await call(back.tool)).content[0].text).toContain('FLAKY-hi')
    expect(f.store.get(id)?.state).toBe('connected')
    expect(f.store.get(id)?.lastWorkedAt).toBeNumber()
  } finally {
    back.stop()
  }
})
