import { expect, test } from 'bun:test'
import { t3Connection } from '../../../server/connections/t3-connection'
import { connectionPreparer, prepareConnections, serverConfig } from '../../../server/engines/hermes/hermes-connections'
import { systemConnection } from '../../../server/system/system-connection'

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
  const { prepare } = connectionPreparer(async () => {
    opened++
    return { ...fake, close: () => {} }
  })
  await Promise.all([prepare('p1', [connection]), prepare('p1', [connection])])
  expect(opened).toBe(1)
  expect(fake.calls.filter(call => call.method === 'mcp.servers.add')).toHaveLength(1)
})

test('unrelated inherited MCP failure does not break a proven connected bridge', async () => {
  const fake = {
    request: async (method: string) => {
      if (method === 'mcp.servers.list') return { servers: [] }
      if (method === 'reload.mcp') throw new Error('Hermes refused the request (mcp servers unavailable).')
      if (method === 'mcp.servers.status')
        return {
          servers: [
            { name: 'lilbot_t3', connected: true },
            { name: 'unrelated', connected: false }
          ]
        }
      return {}
    }
  }
  expect(await prepareConnections(fake as any, [connection])).toBe(true)
  fake.request = async (method: string) => {
    if (method === 'mcp.servers.list') return { servers: [] }
    if (method === 'reload.mcp') throw new Error('Hermes refused the request (mcp servers unavailable).')
    if (method === 'mcp.servers.status') return { servers: [{ name: 'lilbot_t3', connected: false }] }
    return {}
  }
  await expect(prepareConnections(fake as any, [connection])).rejects.toThrow('mcp servers unavailable')
})

test('the system connection is added beside T3 without disturbing it, and the pair is applied once per set', async () => {
  const system = systemConnection('http://127.0.0.1:3370', 'token', 'bot-a', ['lilbot_about'], 'v1')
  const t3 = serverConfig(connection)
  const fake = socket([{ name: 'lilbot_t3', url: t3.url, enabled: true, tools: t3.tools }])
  expect(await prepareConnections(fake, [connection, system])).toBe(true)
  expect(fake.calls.map(call => `${call.method}:${call.params?.name ?? ''}`)).toEqual(['mcp.servers.list:', 'mcp.servers.add:lilbot_system', 'reload.mcp:'])
  expect(fake.calls[1].params.bearer_token).toBe(system.bearerToken)
  expect(fake.calls[1].params.config.url).toBe('http://127.0.0.1:3370/engine/lilbot/mcp?tools=v1')
  // A changed tool list is a new URL, so the server is replaced and Hermes fetches the new tools.
  const next = systemConnection('http://127.0.0.1:3370', 'token', 'bot-a', ['lilbot_about'], 'v2')
  const config = serverConfig(system)
  const replaced = socket([
    { name: 'lilbot_t3', url: t3.url, enabled: true, tools: t3.tools },
    { name: 'lilbot_system', url: config.url, enabled: true, tools: config.tools }
  ])
  expect(await prepareConnections(replaced, [connection, next])).toBe(true)
  expect(replaced.calls.filter(call => call.method === 'mcp.servers.remove').map(call => call.params.name)).toEqual(['lilbot_system'])
})

const service = (name: string, optional = true) => ({
  name,
  url: `http://127.0.0.1:3370/engine/connections/${name}/mcp?v=open`,
  bearerToken: 'k',
  timeoutSeconds: 120,
  tools: ['echo'],
  optional
})

test('LilBot owns only servers named lilbot_*: one it no longer supplies is removed, and Oscar’s own servers are never touched', async () => {
  const t3 = serverConfig(connection)
  const fake = socket([
    { name: 'lilbot_t3', url: t3.url, enabled: true, tools: t3.tools },
    { name: 'lilbot_c_gone', url: 'http://127.0.0.1:3370/engine/connections/gone/mcp', enabled: true, tools: { include: ['x'] } },
    { name: 'paper', url: 'https://paper.example/mcp', enabled: true },
    { name: 'revenuecat', url: 'https://mcp.revenuecat.ai/mcp', enabled: true }
  ])
  // A connection whose name is not LilBot's is ignored rather than allowed to replace Oscar's `paper`.
  expect(await prepareConnections(fake, [connection, { ...service('paper'), name: 'paper' }])).toBe(true)
  expect(fake.calls.map(call => `${call.method}:${call.params?.name ?? ''}`)).toEqual(['mcp.servers.list:', 'mcp.servers.remove:lilbot_c_gone', 'reload.mcp:'])
})

test('a service a bot added may fail to connect without failing the bot; LilBot’s own connections may not', async () => {
  const failing = (connected: string[]) => ({
    request: async (method: string) => {
      if (method === 'mcp.servers.list') return { servers: [] }
      if (method === 'reload.mcp') throw new Error('Hermes refused the request (mcp servers unavailable).')
      if (method === 'mcp.servers.status') return { servers: connected.map(name => ({ name, connected: true })) }
      return {}
    }
  })
  expect(await prepareConnections(failing(['lilbot_t3']) as any, [connection, service('lilbot_c_down')])).toBe(true)
  await expect(prepareConnections(failing(['lilbot_c_down']) as any, [connection, service('lilbot_c_down')])).rejects.toThrow('mcp servers unavailable')
})

test('applying to open chats reloads each with its session id and reports applied, busy or not open, after the profile’s preparation', async () => {
  const sent: string[] = []
  const answers: Record<string, unknown> = { live: { status: 'reloaded', session: 'applied' }, running: { status: 'reloaded', session: 'busy' }, closed: { status: 'reloaded' } }
  const fake = {
    request: async (method: string, params: any) => {
      sent.push(`${method}:${params?.session_id ?? params?.name ?? ''}`)
      if (method === 'mcp.servers.list') return { servers: [] }
      if (method === 'reload.mcp' && params.session_id === 'failing') throw new Error('Hermes refused the request (mcp servers unavailable).')
      return method === 'reload.mcp' && params.session_id ? answers[params.session_id] : { ok: true }
    },
    close: () => {}
  }
  const { prepare, apply } = connectionPreparer(async () => fake as any)
  const [, applied] = await Promise.all([prepare('p1', [connection]), apply('p1', ['live', 'running', 'closed', 'failing'])])
  expect(applied).toEqual([
    { chatId: 'live', state: 'applied' },
    { chatId: 'running', state: 'busy' },
    { chatId: 'closed', state: 'not_open' },
    { chatId: 'failing', state: 'unchanged' }
  ])
  expect(sent.slice(0, 3)).toEqual(['mcp.servers.list:', 'mcp.servers.add:lilbot_t3', 'reload.mcp:'])
  expect(sent.slice(3)).toEqual(['reload.mcp:live', 'reload.mcp:running', 'reload.mcp:closed', 'reload.mcp:failing'])
})
