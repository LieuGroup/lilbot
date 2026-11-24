/** Engine-agnostic conformance suite (Part 6d: real private HTTP/WS listener, Access door JWT gate, and Public door webhook ingress).
 *  Runs LilBot's real HTTP/WebSocket entry points over ScriptedEngine with zero engine plugins. */
import { afterEach, describe, expect, test } from 'bun:test'
import { createHmac } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { WebSocketHandler } from 'bun'
import { startAccessDoor } from '../../server/http/access-door'
import { appRoutes, type SocketData } from '../../server/http/app-routes'
import { BrowserSession } from '../../server/http/browser-session'
import { isTunnelRequest } from '../../server/http/listener-safety'
import { startPublicDoor } from '../../server/http/public-door'
import { allowedHosts } from '../../server/http/socket-guard'
import { webhookRoute } from '../../server/http/webhook-route'
import type { EventFrame, ResponseFrame } from '../../shared/protocol'
import { token as accessJwt, fakeAccess } from '../http/access-fixture'
import { startConformanceApp, waitFor } from './conformance-fixture'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function makeWsHandler(s: Awaited<ReturnType<typeof startConformanceApp>>['services']): WebSocketHandler<SocketData> {
  return {
    open(ws) {
      const send = (f: ResponseFrame | EventFrame) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(f))
      }
      const mcp = s.mcp.browser(() => s.t3Grants.status())
      ws.data.session = new BrowserSession(
        s.bots,
        send,
        s.activity,
        s.routines,
        s.library,
        s.threads,
        mcp,
        s.computers,
        undefined,
        s.attachments,
        undefined,
        s.devices,
        s.boards.work,
        s.webhooks,
        s.boards.goals
      )
    },
    message: (ws, msg) => void ws.data.session?.handle(typeof msg === 'string' ? msg : msg.toString()),
    close: ws => ws.data.session?.close()
  }
}

async function openWsClient(url: string) {
  const frames: (ResponseFrame | EventFrame)[] = []
  const pending = new Map<number, (frame: ResponseFrame) => void>()
  const ws = new WebSocket(url)
  await new Promise<void>((resolve, reject) => Object.assign(ws, { onopen: () => resolve(), onerror: reject }))
  ws.onmessage = ev => {
    const frame = JSON.parse(String(ev.data)) as ResponseFrame | EventFrame
    frames.push(frame)
    if ('id' in frame) {
      pending.get(frame.id)?.(frame)
      pending.delete(frame.id)
    }
  }
  cleanups.push(() => ws.close())
  let seq = 0
  const rpc = async <T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    const id = ++seq
    const reply = await new Promise<ResponseFrame>(resolve => {
      pending.set(id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
    expect(reply.ok).toBe(true)
    return (reply as { ok: true; result: T }).result
  }
  return { frames, rpc }
}

describe('engine conformance: real HTTP/WS private listener, Access door & Public webhook door', () => {
  test('private listener enforces host/origin/proxy guards, Access door enforces RS256 JWT, and WebSocket drives ScriptedEngine', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    engine.setTurnHandler(async ctx => {
      ctx.emitDelta('streamed ')
      return 'streamed reply'
    })

    const websocket = makeWsHandler(services)
    let routes!: ReturnType<typeof appRoutes>
    const privateServer = Bun.serve<SocketData>({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (request, server) => (isTunnelRequest(request) ? new Response('Forbidden', { status: 403 }) : routes(request, server)),
      websocket
    })
    cleanups.push(() => privateServer.stop(true))
    routes = appRoutes(services.library, app.dir, allowedHosts(privateServer.port!, undefined), 'scripted', services.attachments, undefined, services.threads)
    const base = `http://127.0.0.1:${privateServer.port}`

    // Host, Origin, cross-site, and Cloudflare proxy-header refusals on private listener.
    expect((await fetch(`${base}/ws`, { headers: { host: 'evil.example' } })).status).toBe(403)
    expect((await fetch(`${base}/ws`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await fetch(`${base}/api/library/b/item`, { headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403)
    expect((await fetch(`${base}/api/health`, { headers: { 'cf-connecting-ip': '203.0.113.10' } })).status).toBe(403)
    expect((await fetch(`${base}/ws`, { headers: { 'cf-ray': '1234-SYD' } })).status).toBe(403)
    expect((await fetch(`${base}/api/health`, { headers: { 'cdn-loop': 'cloudflare; loops=1' } })).status).toBe(403)

    // Access door enforces RS256 JWT, Host match, and refuses /engine* and /helper*.
    const access = fakeAccess()
    cleanups.push(() => access.server.stop(true))
    const accHost = access.settings.host
    const accRoutes = appRoutes(services.library, app.dir, new Set([accHost]), 'scripted', services.attachments, undefined, services.threads)
    const accessServer = startAccessDoor(access.settings, accRoutes, websocket)
    cleanups.push(() => accessServer.stop(true))
    const accBase = `http://127.0.0.1:${accessServer.port}`
    expect((await fetch(`${accBase}/api/health`, { headers: { host: accHost } })).status).toBe(403)
    expect((await fetch(`${accBase}/api/health`, { headers: { host: accHost, 'cf-access-jwt-assertion': accessJwt({ email: 'other@example.com' }) } })).status).toBe(403)
    expect((await fetch(`${accBase}/api/health`, { headers: { host: 'wrong.example', 'cf-access-jwt-assertion': accessJwt() } })).status).toBe(403)
    expect((await fetch(`${accBase}/engine/lilbot/mcp`, { headers: { host: accHost, 'cf-access-jwt-assertion': accessJwt() } })).status).toBe(403)
    expect((await fetch(`${accBase}/helper/register`, { method: 'POST', headers: { host: accHost, 'cf-access-jwt-assertion': accessJwt() } })).status).toBe(403)
    expect((await fetch(`${accBase}/api/health`, { headers: { host: accHost, 'cf-access-jwt-assertion': accessJwt() } })).status).toBe(200)

    // Real WebSocket BrowserSession round-trip over the private listener.
    const { frames, rpc } = await openWsClient(`ws://127.0.0.1:${privateServer.port}/ws`)
    const created = await rpc<{ id: string }>('bots.create', { name: 'BrowserBot', function: 'Web test', instructions: '' })
    expect((await rpc<any[]>('bots.list')).some(b => b.id === created.id)).toBe(true)
    expect((await rpc<any[]>('models.list', { botId: created.id })).length).toBeGreaterThan(0)
    const opened = await rpc<{ chatId: string }>('chat.open', { botId: created.id })
    await rpc('chat.send', { chatId: opened.chatId, text: 'hello via ws' })
    expect(frames.some(f => 'event' in f && f.event === 'chat' && f.chatId === opened.chatId && f.data.type === 'text.delta')).toBe(true)
    await waitFor(async () => (await rpc<{ items: any[] }>('chat.history', { botId: created.id })).items.length > 0)
    expect(Array.isArray(await rpc<any[]>('work.list', { botId: created.id }))).toBe(true)
    expect(Array.isArray(await rpc<any[]>('goals.list', { botId: created.id }))).toBe(true)
    expect(Array.isArray(await rpc<any[]>('threads.list', { botId: created.id }))).toBe(true)
  })

  test('public door enforces webhook signatures, documented status codes, and narrow capabilities on HTTP-triggered runs', async () => {
    const app = await startConformanceApp()
    cleanups.push(app.close)
    const { engine, services } = app
    const bot = await services.bots.createBot({ name: 'HookBot', function: 'Hooks', instructions: '' })
    const chat = await services.bots.openChat(bot.id, undefined, () => {})
    writeFileSync(join(chat.snapshot.workspace, 'note.txt'), 'narrow ok')
    chat.close()

    const door = startPublicDoor(services.computers, 0, { hooks: webhookRoute(services.webhooks) })
    cleanups.push(() => door.stop(true))
    const secret = 'top-secret-key-1234'
    const hook = await services.webhooks.create(bot.id, {
      requestId: 'wh-http',
      description: 'Signed hook',
      source: 'GitHub',
      createdBy: 'oscar',
      signing: { scheme: 'hmac-sha256', header: 'x-sig', secret }
    })
    const url = `http://127.0.0.1:${door.port}/hook/${hook.address.split('/hook/').at(-1)!}`
    const body = JSON.stringify({ action: 'opened' })
    const sig = createHmac('sha256', secret).update(body).digest('hex')
    const signed = { 'content-type': 'application/json', 'x-sig': `sha256=${sig}` }

    expect((await fetch(`http://127.0.0.1:${door.port}/hook/${'a'.repeat(48)}`, { method: 'POST', body })).status).toBe(404)
    expect((await fetch(`${url}?q=1`, { method: 'POST', body })).status).toBe(403)
    expect((await fetch(url, { method: 'POST', headers: { origin: 'https://evil.example' }, body })).status).toBe(403)
    expect((await fetch(url, { method: 'POST', body })).status).toBe(401)
    expect((await fetch(url, { method: 'POST', headers: { 'x-sig': `sha256=${'0'.repeat(64)}` }, body })).status).toBe(401)
    expect((await fetch(url, { method: 'POST', headers: signed, body: 'x'.repeat(260 * 1024) })).status).toBe(413)
    await services.webhooks.pause(bot.id, hook.id, true)
    expect((await fetch(url, { method: 'POST', headers: signed, body })).status).toBe(409)
    await services.webhooks.pause(bot.id, hook.id, false)

    const accepted = await fetch(url, { method: 'POST', headers: signed, body })
    expect([accepted.status, await accepted.text()]).toEqual([202, 'Accepted'])
    const dup = await fetch(url, { method: 'POST', headers: signed, body })
    expect([dup.status, await dup.text()]).toEqual([202, 'Already received'])

    let [readOk, memoryBlocked, botCreateBlocked] = [false, false, false]
    engine.setTurnHandler(async ctx => {
      readOk = (await ctx.callMcp('lilbot_workspace_read', { path: 'note.txt' })).ok
      memoryBlocked = !(await ctx.callMcp('lilbot_memory_save', { kind: 'journal', scope: 'bot', text: 'nope' })).ok
      botCreateBlocked = !(await ctx.callMcp('lilbot_bot_create', { requestId: 'bc-1', name: 'Bad', function: '', instructions: '' })).ok
      return 'webhook handled over http'
    })
    services.webhooks.store.claimDue(Date.now() + 10_000)
    const [due] = services.webhooks.store.pending()
    await services.webhooks.run(due)
    expect(engine.routineCalls.at(-1)?.options.access).toEqual({ kind: 'webhook', capabilities: [] })
    expect([readOk, memoryBlocked, botCreateBlocked]).toEqual([true, true, true])
    const runView = await services.webhooks.openRun(bot.id, due.id, () => {})
    runView.close()
    expect(runView.snapshot.items.some(i => i.kind === 'assistant' && i.text.includes('webhook handled over http'))).toBe(true)
  })
})
