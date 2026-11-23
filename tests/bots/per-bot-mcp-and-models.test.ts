/** Multi-engine per-bot MCP tool-name mapping and per-engine model listing (PR #257 follow-ups). */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ActivityService } from '../../server/activity/activity-service'
import { ActivityStore } from '../../server/activity/activity-store'
import { createConnections } from '../../server/app-connections'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { BotService } from '../../server/bots/bot-service'
import { BotStore } from '../../server/bots/bot-store'
import { Workspaces } from '../../server/bots/workspaces'
import { CodingSwitchNotice } from '../../server/connections/coding-switch-notice'
import { connectionKey } from '../../server/connections/connection-keys'
import { serviceKeyPurpose } from '../../server/connections/mcp-service-connection'
import { T3Grants } from '../../server/connections/t3-grant'
import { openDatabase } from '../../server/database/database'
import { EngineRegistry } from '../../server/engines/engine-registry'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { HistoryStore } from '../../server/history/history-store'
import { BrowserSession } from '../../server/http/browser-session'
import { MemoryService } from '../../server/memory/memory-service'
import { MemoryStore } from '../../server/memory/memory-store'
import { botTools } from '../../server/system/tool-bots'
import { CallingChats } from '../../server/threads/calling-chats'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function startMockMcp() {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const body = (await req.json().catch(() => null)) as { id?: number; method?: string; params?: { name?: string } } | null
      if (!body || body.id === undefined) return new Response(null, { status: 202 })
      if (body.method === 'initialize') return Response.json({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} } } })
      if (body.method === 'tools/list') return Response.json({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'a-b' }, { name: 'a.b' }] } })
      if (body.method === 'tools/call') return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: `ok:${body.params?.name}` }] } })
      return Response.json({ jsonrpc: '2.0', id: body.id, result: {} })
    }
  })
  cleanups.push(() => server.stop(true))
  return `http://127.0.0.1:${server.port}/mcp`
}

function setupMultiEngine() {
  const root = mkdtempSync(join(tmpdir(), 'lilbot-per-bot-'))
  cleanups.push(() => rmSync(root, { recursive: true, force: true }))
  const database = openDatabase(join(root, 'lilbot.db'))
  cleanups.push(() => database.close())
  const engineA = new ScriptedEngine({
    id: 'engine-a',
    models: [{ provider: 'alpha', name: 'Alpha', models: ['alpha-1'], capabilities: [{ id: 'alpha-1', reasoning: true, canDisableReasoning: true }] }],
    mcpToolName: (server, tool) => `a_${server}_${tool.replaceAll(/[-.]/g, '_')}`
  })
  const engineB = new ScriptedEngine({
    id: 'engine-b',
    models: [{ provider: 'beta', name: 'Beta', models: ['beta-1'], capabilities: [{ id: 'beta-1', reasoning: true, canDisableReasoning: true }] }],
    mcpToolName: (server, tool) => `b::${server}::${tool}`
  })
  const engines = new EngineRegistry([engineA, engineB], 'engine-a')
  const store = new BotStore(database)
  const prefs = new BotPrefsStore(database)
  const workspaces = new Workspaces(join(root, 'workspaces'))
  const memory = new MemoryService(new MemoryStore(database))
  const activity = new ActivityService(new ActivityStore(database), () => {})
  cleanups.push(() => activity.close())
  const bots = new BotService(engines, store, prefs, workspaces, memory)
  const calls = new CallingChats()
  const refusals: { botId: string; tool: string }[] = []
  const token = 'test-engine-token'
  const port = 3399
  const connections = createConnections({
    database,
    dataDir: root,
    port,
    engineToken: token,
    redirectUri: undefined,
    callbackEnabled: false,
    engines,
    store,
    prefs,
    bots,
    activity,
    history: new HistoryStore(database),
    hiddenChat: () => false,
    calls,
    codingSwitch: new CodingSwitchNotice(join(root, 'coding-switch.json')),
    t3Grants: new T3Grants(join(root, 't3-grant.json'), () => {}),
    t3Refusal: async () => null,
    serviceRefusal: async (botId, tool) => {
      refusals.push({ botId, tool })
      return null
    },
    publish: () => {},
    repeat: () => undefined
  })
  return { root, database, store, engines, bots, activity, calls, connections, refusals, token, port }
}

test('MCP probe and service forwarding resolve mcpToolName from the calling bot’s own engine', async () => {
  const f = setupMultiEngine()
  const address = startMockMcp()
  const botA = await f.bots.createBot({ name: 'Alpha Bot', function: '', instructions: '' }, 'bot-a', 'engine-a')
  const botB = await f.bots.createBot({ name: 'Beta Bot', function: '', instructions: '' }, 'bot-b', 'engine-b')

  // Bot B (engine-b) keeps a-b and a.b distinct, whereas default engine-a would collapse them.
  f.calls.saw(botB.id, 'chat-b', 'lilbot_connection', { requestId: 'req-b' }, 'c-b')
  const addedByB = (await f.connections.services.add(botB.id, { name: 'svc_b', address, requestId: 'req-b' })) as { id: string; tools: number }
  expect(addedByB.tools).toBe(2)
  expect(f.connections.services.get(addedByB.id)?.toolNames).toEqual(['a-b', 'a.b'])

  // Bot A (engine-a) collapses a-b and a.b using engine-a's own normalizer.
  f.calls.saw(botA.id, 'chat-a', 'lilbot_connection', { requestId: 'req-a' }, 'c-a')
  const addedByA = (await f.connections.services.add(botA.id, { name: 'svc_a', address, requestId: 'req-a' })) as { id: string; tools: number }
  expect(addedByA.tools).toBe(1)
  expect(f.connections.services.get(addedByA.id)?.toolNames).toEqual(['a-b'])

  // Forwarding tools/call for the same service reports each bot's own engine tool name to serviceRefusal.
  const callTool = async (botId: string, connId: string, tool: string) => {
    const key = connectionKey(f.token, serviceKeyPurpose(connId), botId)
    const req = new Request(`http://127.0.0.1:${f.port}/engine/connections/${connId}/mcp`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${f.port}`, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: {} } })
    })
    const res = await f.connections.forward(req, `/engine/connections/${connId}/mcp`)
    expect(res.status).toBe(200)
  }

  await callTool(botB.id, addedByB.id, 'a-b')
  await callTool(botA.id, addedByB.id, 'a-b')
  expect(f.refusals).toEqual([
    { botId: botB.id, tool: 'b::lilbot_c_svc_b::a-b' },
    { botId: botA.id, tool: 'a_lilbot_c_svc_b_a_b' }
  ])

  // Forwarding tools/list refreshes stored toolNames using the calling bot's own engine normalizer (not default engine-a).
  const keyB = connectionKey(f.token, serviceKeyPurpose(addedByA.id), botB.id)
  const listReq = new Request(`http://127.0.0.1:${f.port}/engine/connections/${addedByA.id}/mcp`, {
    method: 'POST',
    headers: { host: `127.0.0.1:${f.port}`, authorization: `Bearer ${keyB}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
  })
  const listRes = await f.connections.forward(listReq, `/engine/connections/${addedByA.id}/mcp`)
  expect(listRes.status).toBe(200)
  expect(f.connections.services.get(addedByA.id)?.toolNames).toEqual(['a-b', 'a.b'])
})

test('models.list and lilbot_models_list return models for the requested bot or engine', async () => {
  const f = setupMultiEngine()
  const botA = await f.bots.createBot({ name: 'Alpha Bot', function: '', instructions: '' }, 'bot-a', 'engine-a')
  const botB = await f.bots.createBot({ name: 'Beta Bot', function: '', instructions: '' }, 'bot-b', 'engine-b')
  f.store.save({
    id: 'ghost-1',
    name: 'Ghost',
    function: '',
    instructions: '',
    model: null,
    reasoningEffort: null,
    isDefault: false,
    permissionMode: 'full-access',
    engineId: 'missing-engine',
    engineBotId: 'native-ghost'
  })

  const frames: any[] = []
  const session = new BrowserSession(f.bots, frame => frames.push(frame))
  cleanups.push(() => session.close())
  const call = async (id: number, params: Record<string, unknown>) => {
    await session.handle(JSON.stringify({ id, method: 'models.list', params }))
    return frames.at(-1)
  }

  // Omitted target preserves default-engine listing for existing clients.
  expect((await call(1, {})).result[0].models).toEqual(['alpha-1'])
  expect((await call(2, { botId: botB.id })).result[0].models).toEqual(['beta-1'])
  expect((await call(3, { engineId: 'engine-b' })).result[0].models).toEqual(['beta-1'])
  expect((await call(4, { botId: botA.id, engineId: 'engine-b' })).error.code).toBe('invalid_params')
  expect((await call(5, { engineId: 'missing-engine' })).error.code).toBe('runtime_unavailable')
  expect((await call(6, { botId: 'ghost-1' })).error.code).toBe('runtime_unavailable')

  // lilbot_models_list defaults to the calling bot's own engine and supports inspecting another bot's engine.
  const tool = botTools({ bots: f.bots, activity: f.activity } as any).find(t => t.name === 'lilbot_models_list')!
  const bOwn = (await tool.run(botB.id, {})) as { models: string[] }[]
  expect(bOwn[0]!.models).toEqual(['beta-1'])
  const bViewingA = (await tool.run(botB.id, { botId: botA.id })) as { models: string[] }[]
  expect(bViewingA[0]!.models).toEqual(['alpha-1'])
})
