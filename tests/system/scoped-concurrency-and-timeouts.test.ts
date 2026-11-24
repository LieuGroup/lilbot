import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { BotCreation } from '../../server/bots/bot-creation'
import { BotStore } from '../../server/bots/bot-store'
import { openDatabase } from '../../server/database/database'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { actionTool, type McpCallContext, readTool } from '../../server/system/mcp-tool'
import { createScopedMcp, SCOPED_T3_WAIT_CAP_MS } from '../../server/system/scoped-mcp'
import { SessionGrants, sessionGrantToken } from '../../server/system/session-grants'
import { SystemChanges } from '../../server/system/system-changes'
import { createSystemMcp } from '../../server/system/system-mcp'
import { computerTools, SCOPED_COMPUTER_WAIT_MS } from '../../server/system/tool-computers'
import { CallingChats } from '../../server/threads/calling-chats'

const TOKEN = 'concurrency-secret-token'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function startServer(db: ReturnType<typeof openDatabase>, grants: SessionGrants, t3Forward?: (botId: string, req: Request) => Promise<Response>) {
  const executed: { tool: string; ctx?: McpCallContext }[] = []
  const anyObj = z.record(z.string(), z.unknown())
  const rec = (tool: string) => async (_b: string, _a: unknown, _r: unknown, ctx?: McpCallContext) => {
    executed.push({ tool, ctx })
    return { ok: true }
  }
  const tools = [
    readTool('lilbot_about', 'about', anyObj, rec('lilbot_about')),
    actionTool('lilbot_bot_edit', 'edit', anyObj, rec('lilbot_bot_edit')),
    actionTool('lilbot_memory_save', 'save', anyObj, rec('lilbot_memory_save')),
    actionTool('lilbot_work', 'work', anyObj, rec('lilbot_work')),
    actionTool('lilbot_webhook_message', 'msg', anyObj, rec('lilbot_webhook_message'))
  ]
  const changes = new SystemChanges(db)
  let system!: ReturnType<typeof createSystemMcp>
  let scoped!: ReturnType<typeof createScopedMcp>
  let gateCalls = 0
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch(req) {
      const path = new URL(req.url).pathname
      return path === '/engine/lilbot/mcp' ? system(req) : scoped(req, path)
    }
  })
  cleanups.push(() => server.stop(true))
  system = createSystemMcp({
    engineToken: TOKEN,
    port: server.port!,
    bots: () => [{ id: 'b1', name: 'Bot One' }],
    tools,
    changes,
    instructions: 'full',
    refusal: async () => {
      gateCalls++
      return 'legacy gate should never run'
    },
    hasLegacyUngrantedRun: botId => grants.hasLegacyUngrantedRun(botId)
  })
  scoped = createScopedMcp({
    port: server.port!,
    grants,
    bots: () => [{ id: 'b1', name: 'Bot One' }],
    tools,
    changes,
    beyondOwn: () => false,
    t3Enabled: Boolean(t3Forward),
    t3Forward
  })
  return { port: server.port!, url: `http://127.0.0.1:${server.port}`, executed, gateCalls: () => gateCalls }
}

describe('Session-bound concurrency isolation, second engine, and 30 s tool bounds', () => {
  test('concurrent ordinary starts never leak permissions into checks or webhooks, and ordinary calls never hit legacy gating', async () => {
    const db = openDatabase(':memory:')
    db.query("INSERT INTO bots VALUES ('b1', 'Bot One', '', '', NULL, 1, 'scripted', 'n1', NULL, 'full-access', NULL)").run()
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    const srv = startServer(db, grants)
    const calls = new CallingChats(300)
    // Stale ordinary chat tool.start for mutating tools while limited sessions run concurrently.
    calls.saw('b1', 'main-chat', 'lilbot_bot_edit', { name: 'Renamed' }, 'call-ord-1')
    calls.saw('b1', 'main-chat', 'lilbot_memory_save', { text: 'Saved note' }, 'call-ord-2')

    const checkGrant = grants.ensure({ ownerKey: 'check:ck1', botId: 'b1', scope: { kind: 'check', checkId: 'ck1' } })
    const hookGrant = grants.ensure({ ownerKey: 'webhook:wr1', botId: 'b1', scope: { kind: 'webhook', runId: 'wr1', capabilities: [] } })

    const engine = new ScriptedEngine({
      id: 'scripted',
      onTurn: async ({ input, callMcp }) => {
        if (input.text === 'check') {
          const denied = await callMcp('lilbot_bot_edit', { name: 'Renamed' })
          const verdict = await callMcp('lilbot_work', { itemId: 'i1', verdict: 'verified' })
          return { text: JSON.stringify({ deniedOk: denied.ok, verdictOk: verdict.ok }) }
        }
        const deniedMem = await callMcp('lilbot_memory_save', { text: 'Saved note' })
        const sent = await callMcp('lilbot_webhook_message', { requestId: 'r1', text: 'note' })
        return { text: JSON.stringify({ deniedMemOk: deniedMem.ok, sentOk: sent.ok }) }
      }
    })
    const nativeId = await engine.createRuntime({
      id: 'b1',
      name: 'Bot One',
      function: '',
      instructions: '',
      model: null,
      reasoningEffort: null,
      permissionMode: 'full-access',
      isDefault: false
    })
    const ws = mkdtempSync(join(tmpdir(), 'scoped-conc-'))
    cleanups.push(() => rmSync(ws, { recursive: true, force: true }))

    // Engine refuses limited sessions without sessionMcp.
    await expect(engine.runRoutine(nativeId, 'check', { runId: 'no-mcp', workspace: ws, access: 'check', onChat: () => {} })).rejects.toThrow(/session-bound/)

    const checkConns = grants.connectionsFor(checkGrant, srv.url, ['lilbot_about', 'lilbot_work'], false)
    const hookConns = grants.connectionsFor(hookGrant, srv.url, ['lilbot_work', 'lilbot_webhook_message'], false)
    const [checkRes, hookRes] = await Promise.all([
      engine.runRoutine(nativeId, 'check', {
        runId: 'ck1',
        workspace: ws,
        access: 'check',
        sessionMcp: checkConns,
        assertSessionMcpReady: () => grants.assertDiscovered(checkGrant.id, ['lilbot']),
        onChat: id => grants.bindChat(checkGrant.id, id)
      }),
      engine.runRoutine(nativeId, 'hook', {
        runId: 'wr1',
        workspace: ws,
        access: { kind: 'webhook', capabilities: [] },
        sessionMcp: hookConns,
        assertSessionMcpReady: () => grants.assertDiscovered(hookGrant.id, ['lilbot']),
        onChat: id => grants.bindChat(hookGrant.id, id)
      })
    ])
    expect(JSON.parse(checkRes.text)).toEqual({ deniedOk: false, verdictOk: true })
    expect(JSON.parse(hookRes.text)).toEqual({ deniedMemOk: false, sentOk: true })

    // Ordinary full-access call with ZERO tool.start events (closed-browser scenario) completes immediately with zero gate calls.
    const { connectionKey } = await import('../../server/connections/connection-keys')
    const { SYSTEM_KEY_PURPOSE } = await import('../../server/system/system-connection')
    const ordTok = connectionKey(TOKEN, SYSTEM_KEY_PURPOSE, 'b1')
    const t0 = Date.now()
    const ordRes = await fetch(`${srv.url}/engine/lilbot/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ordTok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'lilbot_bot_edit', arguments: { name: 'Renamed' } } })
    })
    expect(Date.now() - t0).toBeLessThan(200)
    expect(((await ordRes.json()) as any).result.isError).toBeUndefined()
    expect(srv.gateCalls()).toBe(0)
    db.close()
  })

  test('session-bound long-running tools stay under Hermes 30 s editor MCP timeout', async () => {
    // 1. t3_thread_wait timeoutMs is clamped to SCOPED_T3_WAIT_CAP_MS (20 s).
    const db = openDatabase(':memory:')
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    let forwardedTimeout: number | undefined
    const srv = startServer(db, grants, async (_botId, req) => {
      const body = (await req.json()) as any
      forwardedTimeout = body.params?.arguments?.timeoutMs
      return Response.json({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '{"timedOut":true}' }] } })
    })
    const g = grants.ensure({ ownerKey: 'webhook:t3-1', botId: 'b1', scope: { kind: 'webhook', runId: 't3-1', capabilities: ['coding'] } })
    grants.bindChat(g.id, 'chat-t3')
    const tok = sessionGrantToken(TOKEN, 'b1', g.id)
    const res = await fetch(`${srv.url}/engine/lilbot/session/${g.id}/t3/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 't3_thread_wait', arguments: { threadId: 't1', timeoutMs: 600_000 } } })
    })
    expect(res.status).toBe(200)
    expect(forwardedTimeout).toBe(SCOPED_T3_WAIT_CAP_MS)

    // 2. lilbot_computer_exec passes SCOPED_COMPUTER_WAIT_MS (20 s) when sessionBound is true.
    let seenWait: number | undefined
    const compTool = computerTools({
      computers: {
        submit: async (_b: string, _raw: unknown, maxWait?: number) => {
          seenWait = maxWait
          return { status: 'running' }
        }
      } as any
    } as any).find(t => t.name === 'lilbot_computer_exec')!
    await compTool.run('b1', { computer: 'leader', command: 'echo hi' }, {}, { sessionBound: true })
    expect(seenWait).toBe(SCOPED_COMPUTER_WAIT_MS)
    await compTool.run('b1', { computer: 'leader', command: 'echo hi' }, {}, {})
    expect(seenWait).toBeUndefined()

    // 3. BotCreation with waitForGreeting: false returns immediately while greeting runs in background.
    const store = new BotStore(db)
    let releaseGreeting!: () => void
    const greetingBlocker = new Promise<void>(r => (releaseGreeting = r))
    const creation = new BotCreation(
      {
        createBot: async (_input: any, id: string) => {
          db.query("INSERT INTO bots VALUES (?, 'New', '', '', NULL, 0, 'scripted', 'n2', NULL, 'full-access', NULL)").run(id)
        },
        openChat: async () => ({ send: () => greetingBlocker, close: () => {} })
      } as any,
      store
    )
    const caller = {
      id: 'b1',
      name: 'Bot One',
      function: '',
      instructions: '',
      model: null,
      isDefault: true,
      engineId: 'scripted',
      engineBotId: 'n1',
      reasoningEffort: null,
      permissionMode: 'full-access' as const
    }
    const created = await creation.create(caller, { name: 'Fast', function: 'Help', instructions: 'Be fast.', requestId: 'fast-1' }, { waitForGreeting: false })
    expect(created.greetingPending).toBe(true)
    releaseGreeting()
    await Bun.sleep(20)
    expect(store.creationDone(created.id)).toBe(true)
    db.close()
  })
})
