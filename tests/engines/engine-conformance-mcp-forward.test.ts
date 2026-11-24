/** Engine-agnostic conformance suite (Part 6c: bot-added MCP forwarding, auth/tool/fencing guards & second-engine naming gaps).
 *  Runs LilBot's real control plane over ScriptedEngine with zero engine plugins and no live-engine naming overrides. */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectionKey } from '../../server/connections/connection-keys'
import { serviceKeyPurpose } from '../../server/connections/mcp-service-connection'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import { startConformanceApp } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function startMockUpstream(mode: { unauthorized?: boolean } = {}) {
  let calls = 0
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const msg = (await request.json()) as { id: number; method: string; params?: { name?: string; arguments?: { text?: string } } }
      if (msg.method === 'initialize')
        return Response.json({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'demo', version: '1.0' } } })
      if (msg.method === 'tools/list')
        return Response.json({
          jsonrpc: '2.0',
          id: msg.id,
          result: { tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
        })
      if (msg.method === 'tools/call') {
        if (mode.unauthorized) return new Response('Unauthorized', { status: 401 })
        calls++
        return Response.json({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo:${msg.params?.arguments?.text ?? ''}` }] } })
      }
      return Response.json({ jsonrpc: '2.0', id: msg.id, result: {} })
    }
  })
  cleanups.push(() => server.stop(true))
  return { address: `http://127.0.0.1:${server.port}/mcp`, calls: () => calls }
}

const rpcCall = (port: number, id: string, tool: string, args: Record<string, unknown>, auth?: string) =>
  fetch(`http://127.0.0.1:${port}/engine/connections/${id}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } })
  })

describe('engine conformance: bot-added MCP forwarding', () => {
  test('default ScriptedEngine forwards fenced output, enforces credentials and tool allow-list, handles 401, and blocks webhook runs', async () => {
    const mode = { unauthorized: false }
    const upstream = startMockUpstream(mode)
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services, port, dataDir } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Caller', instructions: '' })
    const doomed = await services.bots.createBot({ name: 'Doomed', function: 'Temp', instructions: '' })
    const token = readFileSync(join(dataDir, 'engine-token'), 'utf8').trim()

    let addedId = ''
    let echoReply = ''
    let webhookRefused = false
    engine.setTurnHandler(async ctx => {
      if (!ctx.hidden && ctx.input.text === 'add service') {
        const res = await ctx.callMcp('lilbot_connection', { action: 'add', requestId: 'conn-1', name: 'demo', address: upstream.address })
        addedId = String((res.data as { id?: string })?.id ?? '')
        return 'added'
      }
      if (!ctx.hidden && ctx.input.text === 'call service') {
        echoReply = (await ctx.callMcp('echo', { text: 'hello' }, 'lilbot_c_demo')).text
        return 'called'
      }
      if (ctx.hidden) {
        webhookRefused = !(await ctx.callMcp('echo', { text: 'blocked' }, 'lilbot_c_demo')).ok
        return 'hook done'
      }
      return 'ok'
    })

    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('add service')
    expect(addedId).toBeTruthy()
    await services.bots.refreshConnections()
    await chat.send('call service')
    chat.close()
    expect(echoReply).toContain('<outside-service-output>')
    expect(echoReply).toContain('echo:hello')
    expect(echoReply).toContain('</outside-service-output>')
    expect(upstream.calls()).toBe(1)

    // Credential refusals: missing, wrong, wrong-purpose/other-connection, unknown bot, and deleted bot.
    const alphaKey = connectionKey(token, serviceKeyPurpose(addedId), alpha.id)
    const doomedKey = connectionKey(token, serviceKeyPurpose(addedId), doomed.id)
    expect((await rpcCall(port, addedId, 'echo', { text: 'x' })).status).toBe(403)
    expect((await rpcCall(port, addedId, 'echo', { text: 'x' }, 'Bearer wrong-token')).status).toBe(403)
    expect((await rpcCall(port, addedId, 'echo', { text: 'x' }, `Bearer ${connectionKey(token, SYSTEM_KEY_PURPOSE, doomed.id)}`)).status).toBe(403)
    expect((await rpcCall(port, addedId, 'echo', { text: 'x' }, `Bearer ${connectionKey(token, serviceKeyPurpose('other-conn'), alpha.id)}`)).status).toBe(403)
    expect((await rpcCall(port, addedId, 'echo', { text: 'x' }, `Bearer ${connectionKey(token, serviceKeyPurpose(addedId), 'unknown-bot')}`)).status).toBe(403)
    expect((await rpcCall(port, addedId, 'echo', { text: 'live' }, `Bearer ${doomedKey}`)).status).toBe(200)
    expect(upstream.calls()).toBe(2)

    // Unlisted tool refused without reaching upstream.
    const unlisted = (await (await rpcCall(port, addedId, 'unlisted_tool', {}, `Bearer ${alphaKey}`)).json()) as { result: { isError: boolean; content: { text: string }[] } }
    expect(unlisted.result.isError).toBe(true)
    expect(unlisted.result.content[0].text).toContain('not one of demo')
    expect(upstream.calls()).toBe(2)

    // Webhook run is refused fail-closed while service is connected.
    const hook = await services.webhooks.create(alpha.id, { requestId: 'wh-conn', description: 'Check gate', source: 'CI', createdBy: 'oscar' })
    services.webhooks.receive(
      services.webhooks.find(hook.address.split('/hook/').at(-1)!)!,
      new TextEncoder().encode('{"ok":true}'),
      new Headers({ 'content-type': 'application/json' })
    )
    services.webhooks.store.claimDue(Date.now() + 10_000)
    await services.webhooks.run(services.webhooks.store.pending()[0])
    expect(webhookRefused).toBe(true)
    expect(upstream.calls()).toBe(2)

    // Upstream 401 is never passed through (moves open service to needs_sign_in); deleting a bot invalidates its key.
    mode.unauthorized = true
    const unauthRes = await rpcCall(port, addedId, 'echo', { text: 'auth' }, `Bearer ${doomedKey}`)
    expect(unauthRes.status).toBe(200)
    expect(services.mcp.services.get(addedId)?.state).toBe('needs_sign_in')
    await services.bots.deleteBot({ botId: doomed.id })
    expect((await rpcCall(port, addedId, 'echo', { text: 'after-delete' }, `Bearer ${doomedKey}`)).status).toBe(403)
  }, 15_000)

  test('non-standard engine mcpToolName prefix supports add, webhook refusal, and post-hook main-chat calls', async () => {
    const upstream = startMockUpstream()
    const app = await startConformanceApp({ mcpToolName: (server, tool) => `eng:${server}:${tool}` })
    cleanups.push(app.close)
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Caller', instructions: '' })
    let addedId = ''
    let postHookEcho = ''
    let webhookRefused = false
    engine.setTurnHandler(async ctx => {
      if (!ctx.hidden && ctx.input.text === 'add') {
        addedId = String(
          ((await ctx.callMcp('lilbot_connection', { action: 'add', requestId: 'c-pref', name: 'demo', address: upstream.address })).data as { id?: string })?.id ?? ''
        )
        return 'added'
      }
      if (!ctx.hidden && ctx.input.text === 'after-hook') {
        postHookEcho = (await ctx.callMcp('echo', { text: 'after' }, 'lilbot_c_demo')).text
        return 'ok'
      }
      if (ctx.hidden) {
        webhookRefused = !(await ctx.callMcp('echo', { text: 'blocked' }, 'lilbot_c_demo')).ok
        return 'hook'
      }
      return 'ok'
    })
    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('add')
    expect(addedId).toBeTruthy()
    await services.bots.refreshConnections()
    const hook = await services.webhooks.create(alpha.id, { requestId: 'wh-pref', description: 'Gate', source: 'CI', createdBy: 'oscar' })
    services.webhooks.receive(services.webhooks.find(hook.address.split('/hook/').at(-1)!)!, new TextEncoder().encode('{}'), new Headers({ 'content-type': 'application/json' }))
    services.webhooks.store.claimDue(Date.now() + 10_000)
    await services.webhooks.run(services.webhooks.store.pending()[0])
    expect(webhookRefused).toBe(true)
    await chat.send('after-hook')
    chat.close()
    expect(postHookEcho).toContain('echo:after')
    expect(upstream.calls()).toBe(1)
  }, 15_000)

  test('default unprefixed ScriptedEngine allows main-chat service call while webhook runs exist', async () => {
    const upstream = startMockUpstream()
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Caller', instructions: '' })
    let postHookEcho = ''
    engine.setTurnHandler(async ctx => {
      if (!ctx.hidden && ctx.input.text === 'add') {
        await ctx.callMcp('lilbot_connection', { action: 'add', requestId: 'c-def', name: 'demo', address: upstream.address })
        return 'added'
      }
      if (!ctx.hidden && ctx.input.text === 'after-hook') {
        postHookEcho = (await ctx.callMcp('echo', { text: 'after-default' }, 'lilbot_c_demo')).text
        return 'ok'
      }
      return 'hook'
    })
    const chat = await services.bots.openChat(alpha.id, undefined, () => {})
    await chat.send('add')
    await services.bots.refreshConnections()
    const hook = await services.webhooks.create(alpha.id, { requestId: 'wh-def', description: 'Gate', source: 'CI', createdBy: 'oscar' })
    services.webhooks.receive(services.webhooks.find(hook.address.split('/hook/').at(-1)!)!, new TextEncoder().encode('{}'), new Headers({ 'content-type': 'application/json' }))
    services.webhooks.store.claimDue(Date.now() + 10_000)
    await services.webhooks.run(services.webhooks.store.pending()[0])
    await chat.send('after-hook')
    chat.close()
    expect(postHookEcho).toContain('echo:after-default')
  }, 15_000)
})
