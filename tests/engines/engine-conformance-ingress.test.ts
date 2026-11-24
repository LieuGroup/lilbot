/** Engine-agnostic conformance suite (Part 6b: bot-added MCP forwarding, BrowserSession JSON-RPC & webhookRoute HTTP ingress).
 *  Runs LilBot's real control plane over ScriptedEngine with zero engine plugins. */
import { afterEach, describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { BrowserSession } from '../../server/http/browser-session'
import { webhookRoute } from '../../server/http/webhook-route'
import type { EventFrame, ResponseFrame } from '../../shared/protocol'
import { startConformanceApp } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for conformance condition.')
    await Bun.sleep(25)
  }
}

describe('engine conformance: MCP forwarding, BrowserSession & webhook HTTP ingress', () => {
  test('bot-added MCP service forwards authenticated calls, blocks webhook runs, and allows main chat while webhook runs exist', async () => {
    let upstreamCalls = 0
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        const msg = (await request.json()) as { id: number; method: string; params?: { name?: string; arguments?: { text?: string } } }
        if (msg.method === 'initialize')
          return Response.json({
            jsonrpc: '2.0',
            id: msg.id,
            result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'demo', version: '1.0' } }
          })
        if (msg.method === 'tools/list')
          return Response.json({
            jsonrpc: '2.0',
            id: msg.id,
            result: { tools: [{ name: 'echo', description: 'Echo text', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }] }
          })
        if (msg.method === 'tools/call') {
          upstreamCalls++
          return Response.json({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `echo:${msg.params?.arguments?.text ?? ''}` }] } })
        }
        return Response.json({ jsonrpc: '2.0', id: msg.id, result: {} })
      }
    })
    cleanups.push(() => upstream.stop(true))

    const app = await startConformanceApp({ mcpToolName: (server, tool) => `mcp__${server}__${tool}` })
    cleanups.push(app.close)
    const { engine, services } = app
    const alpha = await services.bots.createBot({ name: 'Alpha', function: 'Caller', instructions: '' })
    const nativeId = services.store.get(alpha.id).engineBotId

    let addedId = ''
    let echoReply = ''
    let postHookEcho = ''
    let webhookRefused = false
    engine.setTurnHandler(async ctx => {
      if (!ctx.hidden && ctx.input.text === 'add service') {
        const res = await ctx.callMcp('lilbot_connection', { action: 'add', requestId: 'conn-1', name: 'demo', address: `http://127.0.0.1:${upstream.port}/mcp` })
        addedId = String((res.data as { id?: string })?.id ?? '')
        return 'added'
      }
      if (!ctx.hidden && ctx.input.text === 'call service') {
        echoReply = (await ctx.callMcp('echo', { text: 'hello' }, 'lilbot_c_demo')).text
        return 'called'
      }
      if (!ctx.hidden && ctx.input.text === 'call after hook') {
        postHookEcho = (await ctx.callMcp('echo', { text: 'after-hook' }, 'lilbot_c_demo')).text
        return 'called again'
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
    expect(engine.runtimeOf(nativeId)?.connections.some(c => c.name === 'lilbot_c_demo')).toBe(true)

    await chat.send('call service')
    expect(echoReply).toContain('echo:hello')
    expect(upstreamCalls).toBe(1)

    const hook = await services.webhooks.create(alpha.id, { requestId: 'wh-conn', description: 'Check gate', source: 'CI', createdBy: 'oscar' })
    const live = services.webhooks.find(hook.address.split('/hook/').at(-1)!)!
    services.webhooks.receive(live, new TextEncoder().encode('{"ok":true}'), new Headers({ 'content-type': 'application/json' }))
    services.webhooks.store.claimDue(Date.now() + 10_000)
    await services.webhooks.run(services.webhooks.store.pending()[0])
    expect(webhookRefused).toBe(true)
    expect(upstreamCalls).toBe(1)

    await chat.send('call after hook')
    chat.close()
    expect(postHookEcho).toContain('echo:after-hook')
    expect(upstreamCalls).toBe(2)
  })

  test('BrowserSession JSON-RPC and webhookRoute HTTP ingress drive ScriptedEngine end to end', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    engine.setTurnHandler(async ctx => {
      ctx.emitDelta('streamed ')
      return ctx.hidden ? 'webhook handled over http' : 'streamed reply'
    })

    const frames: (ResponseFrame | EventFrame)[] = []
    const session = new BrowserSession(
      services.bots,
      frame => frames.push(frame),
      services.activity,
      services.routines,
      services.library,
      services.threads,
      services.mcp.browser(() => services.t3Grants.status()),
      services.computers,
      undefined,
      services.attachments,
      undefined,
      services.devices,
      services.boards.work,
      services.webhooks,
      services.boards.goals
    )
    cleanups.push(() => session.close())
    let seq = 0
    const rpc = async <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
      const id = ++seq
      await session.handle(JSON.stringify({ id, method, params }))
      const reply = frames.find((f): f is ResponseFrame => 'id' in f && f.id === id)
      expect(reply?.ok).toBe(true)
      return (reply as { ok: true; result: T }).result
    }

    const created = await rpc<{ id: string }>('bots.create', { name: 'BrowserBot', function: 'Web test', instructions: '' })
    expect((await rpc<any[]>('bots.list')).some(b => b.id === created.id)).toBe(true)
    expect((await rpc<any[]>('models.list', { botId: created.id })).length).toBeGreaterThan(0)

    const opened = await rpc<{ chatId: string }>('chat.open', { botId: created.id })
    await rpc('chat.send', { chatId: opened.chatId, text: 'hello via browser' })
    expect(frames.some(f => 'event' in f && f.event === 'chat' && f.chatId === opened.chatId && f.data.type === 'text.delta')).toBe(true)
    await waitFor(async () => (await rpc<{ items: any[] }>('chat.history', { botId: created.id })).items.length > 0)
    expect(Array.isArray(await rpc<any[]>('work.list', { botId: created.id }))).toBe(true)
    expect(Array.isArray(await rpc<any[]>('goals.list', { botId: created.id }))).toBe(true)
    expect(Array.isArray(await rpc<any[]>('threads.list', { botId: created.id }))).toBe(true)

    const hook = await services.webhooks.create(created.id, {
      requestId: 'wh-http',
      description: 'Signed hook',
      source: 'GitHub',
      createdBy: 'oscar',
      signing: { scheme: 'hmac-sha256', header: 'x-sig', secret: 'top-secret-key-1234' }
    })
    const token = hook.address.split('/hook/').at(-1)!
    const route = webhookRoute(services.webhooks)
    const body = JSON.stringify({ action: 'opened' })
    expect(await route(new Request(`https://hooks.example.test/hook/${token}`, { method: 'POST', body }), token, '127.0.0.1')).toEqual([401, 'Signature refused'])
    const sig = createHmac('sha256', 'top-secret-key-1234').update(body).digest('hex')
    expect(
      await route(
        new Request(`https://hooks.example.test/hook/${token}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sig': `sha256=${sig}` }, body }),
        token,
        '127.0.0.1'
      )
    ).toEqual([202, 'Accepted'])

    services.webhooks.store.claimDue(Date.now() + 10_000)
    const [due] = services.webhooks.store.pending()
    await services.webhooks.run(due)
    const listed = await rpc<any[]>('webhooks.list', { botId: created.id })
    expect(listed.some(w => w.id === hook.id)).toBe(true)
    const runView = await rpc<{ items: any[] }>('webhooks.openRun', { botId: created.id, runId: due.id })
    expect(runView.items.some(i => i.kind === 'assistant' && i.text.includes('webhook handled over http'))).toBe(true)
  })
})
