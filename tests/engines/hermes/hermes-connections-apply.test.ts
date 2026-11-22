import { expect, test } from 'bun:test'
import { t3Connection } from '../../../server/connections/t3-connection'
import { connectionPreparer, connectionTokenSteps, prepareConnections, serverConfig } from '../../../server/engines/hermes/hermes-connections'
import { prepareAppliedConnections } from '../../../server/engines/hermes/hermes-connections-apply'

const connection = t3Connection('http://127.0.0.1:3370', 'token', 'bot-a')

const service = (name: string, optional = true) => ({
  name,
  url: `http://127.0.0.1:3370/engine/connections/${name}/mcp?v=open`,
  bearerToken: 'k',
  timeoutSeconds: 120,
  tools: ['echo'],
  optional
})

function socket(servers: Record<string, unknown>[], statuses?: Record<string, unknown>[]) {
  const calls: { method: string; params: any }[] = []
  const connected = statuses ?? servers.map(server => ({ name: server.name, connected: true }))
  const mcpServers = Object.fromEntries(servers.map(server => [String(server.name), { sampling: { enabled: false }, elicitation: { enabled: false }, ...server }]))
  return {
    calls,
    request: async <T>(method: string, params?: any): Promise<T> => {
      calls.push({ method, params })
      if (method === 'mcp.servers.list') return { servers } as T
      if (method === 'config.get') return { config: { mcp_servers: mcpServers } } as T
      if (method === 'mcp.servers.status') return { servers: connected } as T
      return { ok: true } as T
    }
  }
}

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
  expect(fake.calls.map(call => `${call.method}:${call.params?.name ?? ''}`)).toEqual([
    'mcp.servers.list:',
    'config.get:',
    'mcp.servers.status:',
    'mcp.servers.remove:lilbot_c_gone',
    'reload.mcp:'
  ])
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

  const partialOptional = {
    request: async (method: string) => {
      if (method === 'mcp.servers.list') return { servers: [] }
      if (method === 'reload.mcp') return { status: 'reloaded', unavailable: ['lilbot_c_down'] }
      return {}
    }
  }
  expect(await prepareConnections(partialOptional as any, [connection, service('lilbot_c_down')])).toBe(true)
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

test('connectionPreparer.prepare and prepareAppliedConnections report whether MCP servers actually changed or reconnected', async () => {
  const t3 = serverConfig(connection)
  // Case 1: applied() ran with matching token steps and matching connected MCP servers -> false.
  const matching = socket([{ name: 'lilbot_t3', url: t3.url, enabled: true, tools: t3.tools }])
  const p1 = connectionPreparer(async () => ({ ...matching, close: () => {} }))
  const ranWithTokens = async (_id: string, _step: string | null, _key: string, run: (steps: Record<string, string> | null) => Promise<unknown>) => {
    await run(connectionTokenSteps([connection]))
    return true
  }
  expect(await prepareAppliedConnections(p1, 'p1', [connection], ranWithTokens)).toBe(false)
  // Cache hit returns false too without reopening a socket.
  expect(await p1.prepare('p1', [connection])).toBe(false)

  // Case 2: applied() skipped (lilbot-applied.json intact), statusOnly reconnects a parked server -> true.
  const parked = socket([{ name: 'lilbot_t3', url: t3.url, enabled: true, tools: t3.tools }], [{ name: 'lilbot_t3', connected: false }])
  const p2 = connectionPreparer(async () => ({ ...parked, close: () => {} }))
  const skipFirst = async (_id: string, step: string | null, _key: string, run: (steps: Record<string, string> | null) => Promise<unknown>) => {
    if (step) return false
    await run(null)
    return true
  }
  expect(await prepareAppliedConnections(p2, 'p2', [connection], skipFirst)).toBe(true)

  // Case 3: applied() skipped and statusOnly finds every server already connected -> false.
  const healthy = socket([{ name: 'lilbot_t3', url: t3.url, enabled: true, tools: t3.tools }], [{ name: 'lilbot_t3', connected: true }])
  const p3 = connectionPreparer(async () => ({ ...healthy, close: () => {} }))
  expect(await prepareAppliedConnections(p3, 'p3', [connection], skipFirst)).toBe(false)
})
