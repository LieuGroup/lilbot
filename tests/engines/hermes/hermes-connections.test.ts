import { expect, test } from 'bun:test'
import { t3Connection } from '../../../server/connections/t3-connection'
import { connectionPreparer, prepareConnections, serverConfig } from '../../../server/engines/hermes/hermes-connections'

const connection = t3Connection('http://127.0.0.1:3370', 'token', 'bot-a')

function socket(servers: Record<string, unknown>[]) {
  const calls: { method: string; params: any }[] = []
  return {
    calls,
    request: async <T>(method: string, params?: any): Promise<T> => {
      calls.push({ method, params })
      return (method === 'mcp.servers.list' ? { servers } : { ok: true }) as T
    }
  }
}

test('adds the connection with the bot key as Hermes’ bearer token, leaving other servers alone', async () => {
  const fake = socket([{ name: 'github' }])
  await prepareConnections(fake, [connection])
  expect(fake.calls.map(call => call.method)).toEqual(['mcp.servers.list', 'mcp.servers.add', 'reload.mcp'])
  expect(fake.calls[2].params).toEqual({ confirm: true })
  const add = fake.calls[1].params
  expect(add.name).toBe('lilbot_t3')
  expect(add.bearer_token).toBe(connection.bearerToken)
  // The key goes to the profile's .env through bearer_token, never into config.yaml.
  expect(JSON.stringify(add.config)).not.toContain(connection.bearerToken)
  expect(add.config).toEqual(serverConfig(connection))
  expect(add.config.tools.include).toContain('t3_thread_launch')
  expect(add.config.timeout).toBeGreaterThanOrEqual(600)
})

test('a drifted entry is replaced as a whole; a current one is left alone without reloading', async () => {
  const drifted = socket([{ name: 'lilbot_t3', url: 'http://127.0.0.1:1/old', enabled: true, tools: { include: [] } }, { name: 'github' }])
  expect(await prepareConnections(drifted, [connection])).toBe(true)
  expect(drifted.calls.map(call => `${call.method}:${call.params?.name ?? ''}`)).toEqual([
    'mcp.servers.list:',
    'mcp.servers.remove:lilbot_t3',
    'reload.mcp:',
    'mcp.servers.add:lilbot_t3',
    'reload.mcp:'
  ])
  const config = serverConfig(connection)
  const current = socket([{ name: 'lilbot_t3', url: config.url, enabled: true, tools: config.tools }])
  expect(await prepareConnections(current, [connection])).toBe(false)
  expect(current.calls.map(call => call.method)).toEqual(['mcp.servers.list'])
})

test('concurrent preparations of one profile run one after another and apply once', async () => {
  const fake = socket([])
  let opened = 0
  const prepare = connectionPreparer(async () => {
    opened++
    return { ...fake, close: () => {} }
  })
  await Promise.all([prepare('p1', [connection]), prepare('p1', [connection])])
  expect(opened).toBe(1)
  expect(fake.calls.filter(call => call.method === 'mcp.servers.add')).toHaveLength(1)
})
