import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { t3Connection } from '../../../server/connections/t3-connection'
import { applied, hashOf } from '../../../server/engines/hermes/hermes-applied'
import { connectionPreparer, connectionTokenSteps, prepareConnections, serverConfig, staleTokenNames } from '../../../server/engines/hermes/hermes-connections'
import { systemConnection } from '../../../server/system/system-connection'

function socket(servers: Record<string, unknown>[]) {
  const calls: { method: string; params: any }[] = []
  const connected = servers.map(server => ({ name: server.name, connected: true }))
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

let root = ''
let previous: string | undefined
beforeEach(() => {
  previous = process.env.HERMES_HOME
  root = mkdtempSync(join(tmpdir(), 'conn-tokens-test-'))
  process.env.HERMES_HOME = root
  mkdirSync(join(root, 'profiles', 'p1'), { recursive: true })
  writeFileSync(join(root, 'profiles', 'p1', 'config.yaml'), 'approvals:\n  mode: "off"\n')
})
afterEach(() => {
  if (previous === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previous
  rmSync(root, { recursive: true, force: true })
})

test('rotated bearer tokens force replacement even when url, tools, hardening and status still match', async () => {
  const oldT3 = t3Connection('http://127.0.0.1:3370', 'token', 'old-bot')
  const oldSys = systemConnection('http://127.0.0.1:3370', 'token', 'old-bot', ['lilbot_about'], 'v1')
  const newT3 = t3Connection('http://127.0.0.1:3370', 'token', 'new-bot')
  const newSys = systemConnection('http://127.0.0.1:3370', 'token', 'new-bot', ['lilbot_about'], 'v1')

  const existing = [
    { name: 'lilbot_t3', url: serverConfig(oldT3).url, enabled: true, tools: serverConfig(oldT3).tools },
    { name: 'lilbot_system', url: serverConfig(oldSys).url, enabled: true, tools: serverConfig(oldSys).tools }
  ]

  // Simulate an earlier intact apply under old-bot: lilbot-applied.json records old token hashes (never raw tokens).
  await applied('p1', 'connections', hashOf('v2', [oldT3, oldSys]), async () => {}, connectionTokenSteps([oldT3, oldSys]))
  const appliedText = readFileSync(join(root, 'profiles/p1/lilbot-applied.json'), 'utf8')
  expect(appliedText).not.toContain(oldT3.bearerToken)
  expect(appliedText).not.toContain(oldSys.bearerToken)

  // After re-keying to new-bot, URL and tools are identical, but bearer tokens differ.
  const fake = socket(existing)
  const ran = await applied(
    'p1',
    'connections',
    hashOf('v2', [newT3, newSys]),
    async steps => {
      await prepareConnections(fake, [newT3, newSys], staleTokenNames([newT3, newSys], steps))
    },
    connectionTokenSteps([newT3, newSys])
  )
  expect(ran).toBe(true)
  expect(fake.calls.filter(c => c.method === 'mcp.servers.remove').map(c => c.params.name)).toEqual(['lilbot_t3', 'lilbot_system'])
  const added = fake.calls.filter(c => c.method === 'mcp.servers.add')
  expect(added.map(c => ({ name: c.params.name, token: c.params.bearer_token }))).toEqual([
    { name: 'lilbot_t3', token: newT3.bearerToken },
    { name: 'lilbot_system', token: newSys.bearerToken }
  ])

  // Adding a third server later leaves already-current tokens alone without replacing them.
  const extra = { ...newSys, name: 'lilbot_c_demo', url: 'http://127.0.0.1:3370/engine/connections/c1/mcp?v=1', bearerToken: 'extra-token' }
  const thirdSocket = socket(existing)
  await applied(
    'p1',
    'connections',
    hashOf('v2', [newT3, newSys, extra]),
    async steps => {
      await prepareConnections(thirdSocket, [newT3, newSys, extra], staleTokenNames([newT3, newSys, extra], steps))
    },
    connectionTokenSteps([newT3, newSys, extra])
  )
  expect(thirdSocket.calls.filter(c => c.method === 'mcp.servers.remove')).toEqual([])
  expect(thirdSocket.calls.filter(c => c.method === 'mcp.servers.add').map(c => c.params.name)).toEqual(['lilbot_c_demo'])
})

test('an untouched existing bot with a pre-PR v2 lilbot-applied.json has nothing rewritten on startup', async () => {
  const t3 = t3Connection('http://127.0.0.1:3370', 'token', 'default')
  const sys = systemConnection('http://127.0.0.1:3370', 'token', 'default', ['lilbot_about'], 'v1')
  const existing = [
    { name: 'lilbot_t3', url: serverConfig(t3).url, enabled: true, tools: serverConfig(t3).tools },
    { name: 'lilbot_system', url: serverConfig(sys).url, enabled: true, tools: serverConfig(sys).tools }
  ]
  // Pre-PR applied file: v2 connections hash only, no connToken:* step entries.
  await applied('p1', 'connections', hashOf('v2', [t3, sys]), async () => {})
  const fake = socket(existing)
  const preparer = connectionPreparer(async () => ({ ...fake, close: () => {} }))
  const ran = await applied(
    'p1',
    'connections',
    hashOf('v2', [t3, sys]),
    steps => preparer.prepare('p1', [t3, sys], { staleTokens: staleTokenNames([t3, sys], steps) }),
    connectionTokenSteps([t3, sys])
  )
  expect(ran).toBe(false)
  await applied('p1', null, '', () => preparer.prepare('p1', [t3, sys], true))
  expect(fake.calls.filter(c => c.method === 'mcp.servers.remove' || c.method === 'mcp.servers.add' || c.method === 'reload.mcp')).toEqual([])
})

test('connectionPreparer also detects in-process bearer token rotation for the same server config', async () => {
  const oldT3 = t3Connection('http://127.0.0.1:3370', 'token', 'old-bot')
  const newT3 = t3Connection('http://127.0.0.1:3370', 'token', 'new-bot')
  const fake = socket([{ name: 'lilbot_t3', url: serverConfig(oldT3).url, enabled: true, tools: serverConfig(oldT3).tools }])
  const { prepare } = connectionPreparer(async () => ({ ...fake, close: () => {} }))

  await prepare('p1', [oldT3])
  fake.calls.length = 0
  await prepare('p1', [newT3])
  expect(fake.calls.filter(c => c.method === 'mcp.servers.remove').map(c => c.params.name)).toEqual(['lilbot_t3'])
  expect(fake.calls.filter(c => c.method === 'mcp.servers.add').map(c => c.params.bearer_token)).toEqual([newT3.bearerToken])
})
