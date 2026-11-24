import { describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { openDatabase } from '../../server/database/database'
import { actionTool, type McpCallContext, type McpTool, readTool } from '../../server/system/mcp-tool'
import { RUN_TOOLS, TOOL_GROUPS } from '../../server/system/run-access'
import { createScopedMcp } from '../../server/system/scoped-mcp'
import { SessionGrants, sessionGrantToken } from '../../server/system/session-grants'
import { CHECK_REFUSED_READS, REVIEW_TOOLS, scopedToolsFor } from '../../server/system/session-scope'
import { SystemChanges } from '../../server/system/system-changes'
import type { WebhookCapability } from '../../shared/webhook-schema'

const TOKEN = 'parity-secret-token'
const PORT = 3370
const ALL_CAPS: WebhookCapability[] = ['web', 'shell', 'computers', 'coding', 'memory', 'bots', 'delegation', 'routines', 'webhooks']

function sampleTools(calls: { tool: string; ctx?: McpCallContext; args: any }[]): McpTool[] {
  const anyObj = z.record(z.string(), z.unknown())
  const record = (name: string) => async (_b: string, a: any, _r: unknown, ctx?: McpCallContext) => {
    calls.push({ tool: name, ctx, args: a })
    return { ok: true }
  }
  const mkRead = (name: string) => readTool(name, name, anyObj, record(name))
  const mkAct = (name: string) => actionTool(name, name, anyObj, record(name))
  const mkDual = (name: string) => ({ ...mkAct(name), readOnly: (a: any) => a.action === 'status' })
  return [
    mkRead('lilbot_about'),
    mkRead('lilbot_guide'),
    mkRead('lilbot_bots_list'),
    mkRead('lilbot_bot_read'),
    mkAct('lilbot_bot_create'),
    mkAct('lilbot_bot_edit'),
    mkAct('lilbot_primary_set'),
    mkRead('lilbot_models_list'),
    mkRead('lilbot_skill_read'),
    mkAct('lilbot_skill_write'),
    mkRead('lilbot_memory_list'),
    mkRead('lilbot_memory_recall'),
    mkAct('lilbot_memory_save'),
    mkAct('lilbot_memory_forget'),
    mkRead('lilbot_history_search'),
    mkAct('lilbot_delegate'),
    mkDual('lilbot_delegation'),
    mkDual('lilbot_group'),
    mkAct('lilbot_work'),
    mkRead('lilbot_work_list'),
    mkAct('lilbot_goal'),
    mkAct('lilbot_give_file'),
    mkRead('lilbot_workspace_read'),
    mkAct('lilbot_routine'),
    mkRead('lilbot_routines_list'),
    mkAct('lilbot_webhook'),
    mkRead('lilbot_webhooks_list'),
    mkAct('lilbot_webhook_message'),
    mkRead('lilbot_computers_list'),
    mkAct('lilbot_computer_exec'),
    mkRead('lilbot_computer_request_read'),
    mkAct('lilbot_computer_cancel'),
    mkAct('lilbot_computer_copy'),
    mkAct('lilbot_computer_read_file'),
    mkAct('lilbot_computer_write_file'),
    mkAct('lilbot_computer_list_folder'),
    mkAct('lilbot_connection')
  ]
}

async function rpc(handler: (req: Request, path: string) => Promise<Response>, grantId: string, token: string, method: string, params: unknown = {}) {
  const path = `/engine/lilbot/session/${grantId}/mcp`
  const req = new Request(`http://127.0.0.1:${PORT}${path}`, {
    method: 'POST',
    headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
  })
  const res = await handler(req, path)
  return { status: res.status, body: (await res.json()) as any }
}

const refused = (r: { body: any }) => {
  const txt = r.body?.result?.content?.[0]?.text
  try {
    return typeof txt === 'string' ? (JSON.parse(txt).refused ?? null) : null
  } catch {
    return null
  }
}

describe('Scoped MCP tool parity and per-argument rules', () => {
  test('advertises exact LilBot tool parity across all webhook capabilities, narrowed hand-offs, checks, and reviews', () => {
    const tools = sampleTools([])
    const combos: WebhookCapability[][] = [[], ...ALL_CAPS.map(c => [c]), ['shell', 'memory'], ['delegation', 'computers'], ['coding', 'shell'], ALL_CAPS]
    for (const t3Enabled of [false, true]) {
      for (const caps of combos) {
        const expectedHook = new Set<string>(RUN_TOOLS)
        for (const cap of caps) if (cap !== 'coding' || t3Enabled) for (const n of TOOL_GROUPS[cap] ?? []) expectedHook.add(n)
        const listedHook = scopedToolsFor({ kind: 'webhook', runId: 'r1', capabilities: caps }, tools, t3Enabled).map(t => t.name)
        expect(new Set(listedHook)).toEqual(new Set(tools.map(t => t.name).filter(n => expectedHook.has(n))))

        const expectedNarrow = new Set([...expectedHook].filter(n => n !== 'lilbot_webhook_message'))
        const listedNarrow = scopedToolsFor({ kind: 'narrowed', threadId: 't1', capabilities: caps }, tools, t3Enabled).map(t => t.name)
        expect(new Set(listedNarrow)).toEqual(new Set(tools.map(t => t.name).filter(n => expectedNarrow.has(n))))
      }
    }
    const checkListed = new Set(scopedToolsFor({ kind: 'check', checkId: 'c1' }, tools).map(t => t.name))
    for (const refused of CHECK_REFUSED_READS) expect(checkListed.has(refused)).toBe(false)
    expect(checkListed.has('lilbot_work')).toBe(true)
    expect(checkListed.has('lilbot_delegation')).toBe(true)
    expect(checkListed.has('lilbot_group')).toBe(true)
    expect(checkListed.has('lilbot_bot_edit')).toBe(false)
    expect(checkListed.has('lilbot_memory_save')).toBe(false)

    const reviewListed = scopedToolsFor({ kind: 'review', runId: 'rv1' }, tools)
      .map(t => t.name)
      .sort()
    expect(reviewListed).toEqual([...REVIEW_TOOLS].sort())
  })

  test('enforces check dual-mode args, checkId context binding, webhook own-item reads, and unbound/revoked refusal', async () => {
    const db = openDatabase(':memory:')
    const grants = new SessionGrants(db, TOKEN, (_b, c) => c)
    const calls: { tool: string; ctx?: McpCallContext; args: any }[] = []
    const tools = sampleTools(calls)
    const handler = createScopedMcp({
      port: PORT,
      grants,
      bots: () => [{ id: 'b1', name: 'Bot One' }],
      tools,
      changes: new SystemChanges(db),
      beyondOwn: (_bot, tool, args: any) => tool === 'lilbot_work_list' && (args?.mine === false || args?.goals || args?.itemId === 'other-item')
    })

    const checkGrant = grants.ensure({ ownerKey: 'check:ck-1', botId: 'b1', scope: { kind: 'check', checkId: 'ck-1' } })
    const checkTok = sessionGrantToken(TOKEN, 'b1', checkGrant.id)
    expect((await rpc(handler, checkGrant.id, checkTok, 'tools/list')).body.result.tools.length).toBeGreaterThan(0)
    // Unbound primaryChatId refuses tools/call.
    expect(refused(await rpc(handler, checkGrant.id, checkTok, 'tools/call', { name: 'lilbot_about', arguments: {} }))).toContain('not bound')
    grants.bindChat(checkGrant.id, 'check-stored-1')
    grants.bindChat(checkGrant.id, 'check-alias-1')

    // Dual-mode tools allow status only; lilbot_work allows verdict only and passes checkId + primaryChatId.
    expect(refused(await rpc(handler, checkGrant.id, checkTok, 'tools/call', { name: 'lilbot_delegation', arguments: { action: 'status' } }))).toBeNull()
    expect(refused(await rpc(handler, checkGrant.id, checkTok, 'tools/call', { name: 'lilbot_delegation', arguments: { action: 'cancel', exchangeId: 'x' } }))).toContain('check')
    expect(refused(await rpc(handler, checkGrant.id, checkTok, 'tools/call', { name: 'lilbot_group', arguments: { action: 'close', groupId: 'g' } }))).toContain('check')
    expect(refused(await rpc(handler, checkGrant.id, checkTok, 'tools/call', { name: 'lilbot_work', arguments: { title: 'open' } }))).toContain('check')
    expect(refused(await rpc(handler, checkGrant.id, checkTok, 'tools/call', { name: 'lilbot_work', arguments: { itemId: 'i1', verdict: 'verified' } }))).toBeNull()
    expect(calls.at(-1)?.ctx).toEqual({ chatId: 'check-stored-1', checkId: 'ck-1', sessionBound: true })

    // Narrowed grant refuses lilbot_webhook_message and beyondOwn lilbot_work_list; webhook grant passes runId.
    const hookGrant = grants.ensure({ ownerKey: 'webhook:wr-1', botId: 'b1', scope: { kind: 'webhook', runId: 'wr-1', capabilities: [] } })
    grants.bindChat(hookGrant.id, 'hook-chat-1')
    const hookTok = sessionGrantToken(TOKEN, 'b1', hookGrant.id)
    expect(refused(await rpc(handler, hookGrant.id, hookTok, 'tools/call', { name: 'lilbot_work_list', arguments: { mine: false } }))).toContain('own work items')
    expect(refused(await rpc(handler, hookGrant.id, hookTok, 'tools/call', { name: 'lilbot_webhook_message', arguments: { text: 'hi' } }))).toBeNull()
    expect(calls.at(-1)?.ctx).toEqual({ chatId: 'hook-chat-1', capabilities: [], webhookRunId: 'wr-1', sessionBound: true })

    const narrowGrant = grants.ensure({ ownerKey: 'thread:t1:b1', botId: 'b1', scope: { kind: 'narrowed', threadId: 't1', capabilities: ['delegation'] } })
    grants.bindChat(narrowGrant.id, 'narrow-chat-1')
    const narrowTok = sessionGrantToken(TOKEN, 'b1', narrowGrant.id)
    expect(refused(await rpc(handler, narrowGrant.id, narrowTok, 'tools/call', { name: 'lilbot_webhook_message', arguments: { text: 'hi' } }))).toContain('webhook run')

    // Revoking immediately rejects replay with HTTP 403.
    grants.revoke(checkGrant.id)
    expect((await rpc(handler, checkGrant.id, checkTok, 'tools/call', { name: 'lilbot_about', arguments: {} })).status).toBe(403)

    // Browser Origin header is refused on both /mcp and /t3/mcp; /t3/mcp requires 'coding' even when t3Enabled is true.
    let t3Forwarded = 0
    const t3Handler = createScopedMcp({
      port: PORT,
      grants,
      bots: () => [{ id: 'b1', name: 'Bot One' }],
      tools,
      changes: new SystemChanges(db),
      beyondOwn: () => false,
      t3Enabled: true,
      t3Forward: async () => {
        t3Forwarded++
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
    })
    const codingGrant = grants.ensure({ ownerKey: 'webhook:wr-code', botId: 'b1', scope: { kind: 'webhook', runId: 'wr-code', capabilities: ['coding'] } })
    grants.bindChat(codingGrant.id, 'code-chat-1')
    const codingTok = sessionGrantToken(TOKEN, 'b1', codingGrant.id)
    const post = (path: string, tok: string, extra: Record<string, string> = {}) =>
      t3Handler(
        new Request(`http://127.0.0.1:${PORT}${path}`, {
          method: 'POST',
          headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${tok}`, 'content-type': 'application/json', ...extra },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
        }),
        path
      )
    expect((await post(`/engine/lilbot/session/${hookGrant.id}/mcp`, hookTok, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(`/engine/lilbot/session/${codingGrant.id}/t3/mcp`, codingTok, { origin: 'https://evil.example' })).status).toBe(403)
    expect((await post(`/engine/lilbot/session/${hookGrant.id}/t3/mcp`, hookTok)).status).toBe(403)
    expect((await post(`/engine/lilbot/session/${narrowGrant.id}/t3/mcp`, narrowTok)).status).toBe(403)
    expect([t3Forwarded, (await post(`/engine/lilbot/session/${codingGrant.id}/t3/mcp`, codingTok)).status, t3Forwarded]).toEqual([0, 200, 1])
    db.close()
  })
})
