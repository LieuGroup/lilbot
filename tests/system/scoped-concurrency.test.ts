import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { connectionKey } from '../../server/connections/connection-keys'
import { openDatabase } from '../../server/database/database'
import { ScriptedEngine } from '../../server/engines/scripted/scripted-engine'
import { actionTool, type McpCallContext, readTool } from '../../server/system/mcp-tool'
import { createScopedMcp } from '../../server/system/scoped-mcp'
import { SessionGrants } from '../../server/system/session-grants'
import { SystemChanges } from '../../server/system/system-changes'
import { SYSTEM_KEY_PURPOSE } from '../../server/system/system-connection'
import { createSystemMcp } from '../../server/system/system-mcp'
import { CallingChats } from '../../server/threads/calling-chats'

const TOKEN = 'concurrency-secret-token'
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function startServer(db: ReturnType<typeof openDatabase>, grants: SessionGrants) {
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
  scoped = createScopedMcp({ port: server.port!, grants, bots: () => [{ id: 'b1', name: 'Bot One' }], tools, changes, beyondOwn: () => false })
  return { url: `http://127.0.0.1:${server.port}`, gateCalls: () => gateCalls }
}

describe('Session-bound concurrency isolation and second engine', () => {
  test('concurrent ordinary starts never leak permissions into checks or webhooks, and ordinary calls never hit legacy gating', async () => {
    const db = openDatabase(':memory:')
    db.query("INSERT INTO bots VALUES ('b1', 'Bot One', '', '', NULL, 1, 'scripted', 'n1', NULL, 'full-access', NULL)").run()
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    const srv = startServer(db, grants)
    const calls = new CallingChats(300)
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

    // Ordinary full-access call with no tool.start events completes immediately with zero gate calls.
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
})
