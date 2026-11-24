import { describe, expect, test } from 'bun:test'
import { SessionGrants, sessionGrantToken } from '../../server/system/session-grants'
import { createSystemServer } from '../../server/system/system-server'
import type { WebhookCapability } from '../../shared/webhook-schema'
import { systemFixture } from './system-fixture'

const TOKEN = 'test-system-token'
const PORT = 3999
const ALL_CAPS: WebhookCapability[] = ['web', 'shell', 'computers', 'coding', 'memory', 'bots', 'delegation', 'routines', 'webhooks']
const SKILL_DOC = (name: string, body = 'Steps.') => `---\nname: ${name}\ndescription: ${name}\n---\n${body}\n`

async function scopedRpc(handler: (req: Request, path: string) => Promise<Response>, grantId: string, token: string, method: string, params: unknown = {}) {
  const path = `/engine/lilbot/session/${grantId}/mcp`
  const res = await handler(
    new Request(`http://127.0.0.1:${PORT}${path}`, {
      method: 'POST',
      headers: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
    }),
    path
  )
  return { status: res.status, body: (await res.json()) as any }
}

const refusedText = (r: { body: any }): string | null => {
  const txt = r.body?.result?.content?.[0]?.text
  try {
    return typeof txt === 'string' ? (JSON.parse(txt).refused ?? null) : null
  } catch {
    return null
  }
}

function setupGranted() {
  const f = systemFixture()
  f.skills.write({ action: 'create', name: 'existing', content: SKILL_DOC('existing', 'Original.') }, 'oscar')
  const roots = new Map<string, string | null>()
  const grants = new SessionGrants(
    f.database,
    TOKEN,
    (_bot, chat) => (roots.has(chat) ? roots.get(chat)! : chat),
    (_bot, chat) => chat === 'b1-main'
  )
  const server = createSystemServer({
    store: f.store,
    workspaces: f.workspaces,
    computers: {} as any,
    t3: () => ({ status: 'disconnected' }) as any,
    t3Enabled: true,
    commit: 'test',
    bots: f.service,
    activity: f.activity,
    memory: f.memory,
    memoryChanged: () => {},
    history: f.historyService,
    skills: f.skills,
    delegation: { hand: {} as any, control: {} as any, groups: {} as any },
    work: f.work.work,
    routines: f.routines,
    goals: f.goals,
    giveFile: (() => {}) as any,
    library: f.library,
    webhooks: f.webhooks,
    webhookRuns: f.webhookRuns,
    connections: f.connections,
    calls: f.calls,
    checkSessions: { checking: () => false, isCheck: () => false } as any,
    changes: f.changes,
    grants,
    dataDir: f.root,
    engineToken: TOKEN,
    port: PORT
  })
  return { f, grants, roots, server }
}

describe('lilbot_skill_manage fail-closed refusal across every limited-session kind', () => {
  test('omits lilbot_skill_manage from tools/list and refuses every action for check, webhook, narrowed, review, and remote worker', async () => {
    const { f, grants, server } = setupGranted()
    const scoped = server.scoped!
    const cases = [
      { label: 'check', grant: grants.ensure({ ownerKey: 'check:c1', botId: 'b1', scope: { kind: 'check', checkId: 'c1' } }), chat: 'chat-check' },
      { label: 'webhook-empty', grant: grants.ensure({ ownerKey: 'webhook:w0', botId: 'b1', scope: { kind: 'webhook', runId: 'w0', capabilities: [] } }), chat: 'chat-w0' },
      { label: 'webhook-all', grant: grants.ensure({ ownerKey: 'webhook:w1', botId: 'b1', scope: { kind: 'webhook', runId: 'w1', capabilities: ALL_CAPS } }), chat: 'chat-w1' },
      { label: 'narrowed-empty', grant: grants.ensure({ ownerKey: 'thread:t0:b1', botId: 'b1', scope: { kind: 'narrowed', threadId: 't0', capabilities: [] } }), chat: 'chat-t0' },
      {
        label: 'narrowed-all',
        grant: grants.ensure({ ownerKey: 'thread:t1:b1', botId: 'b1', scope: { kind: 'narrowed', threadId: 't1', capabilities: ALL_CAPS } }),
        chat: 'chat-t1'
      },
      { label: 'review', grant: grants.ensure({ ownerKey: 'review:r1', botId: 'b1', scope: { kind: 'review', runId: 'r1' } }), chat: 'chat-rev' }
    ]
    const actions: Record<string, unknown>[] = [
      { action: 'create', name: 'injected', content: SKILL_DOC('injected') },
      { action: 'edit', name: 'existing', content: SKILL_DOC('existing', 'Tampered.') },
      { action: 'patch', name: 'existing', old_string: 'Original.', new_string: 'Tampered.' },
      { action: 'write_file', name: 'existing', file_path: 'references/x.md', content: 'Tampered.' },
      { action: 'set_enabled', name: 'existing', enabled: false }
    ]

    for (const c of cases) {
      const tok = sessionGrantToken(TOKEN, 'b1', c.grant.id)
      // Even before chat binding, tools/list omits lilbot_skill_manage and tools/call refuses it.
      const listed = (await scopedRpc(scoped, c.grant.id, tok, 'tools/list')).body.result.tools.map((t: { name: string }) => t.name)
      expect(listed, c.label).not.toContain('lilbot_skill_manage')
      expect(refusedText(await scopedRpc(scoped, c.grant.id, tok, 'tools/call', { name: 'lilbot_skill_manage', arguments: actions[0] })), `${c.label} unbound`).toContain(
        'Limited sessions cannot write'
      )

      grants.bindChat(c.grant.id, c.chat)
      for (const args of actions) {
        const reply = await scopedRpc(scoped, c.grant.id, tok, 'tools/call', { name: 'lilbot_skill_manage', arguments: args })
        expect(refusedText(reply), `${c.label} ${String(args.action)}`).toContain('Limited sessions cannot write')
      }
      grants.revoke(c.grant.id)
      expect((await scopedRpc(scoped, c.grant.id, tok, 'tools/call', { name: 'lilbot_skill_manage', arguments: actions[0] })).status, `${c.label} revoked`).toBe(403)
    }

    // Remote coding worker MCP also omits and refuses lilbot_skill_manage.
    const wCtx = { botId: 'b1', threadId: 'w1', runId: 'r1', chatId: 'w-chat', computerId: 'comp-1' }
    const wList = JSON.parse((await server.workerMcp(wCtx, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }))).body)
    expect(wList.result.tools.map((t: { name: string }) => t.name)).not.toContain('lilbot_skill_manage')
    const wCall = JSON.parse(
      (await server.workerMcp(wCtx, JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lilbot_skill_manage', arguments: actions[0] } }))).body
    )
    expect(wCall.result.isError).toBe(true)
    expect(wCall.result.content[0].text).toContain('not allowed in a remote worker')

    expect(f.skills.list('b1').some(s => s.name === 'injected')).toBe(false)
    expect(f.skills.read('existing')['SKILL.md']).toContain('Original.')
    expect(f.skills.list('b1').find(s => s.name === 'existing')?.enabled).toBe(true)
    expect(f.changes.recent(20)).toEqual([])
  })

  test('defense-in-depth: direct tool.run fails closed on any limited context or granted/unreadable chat, while concurrent main chat succeeds', async () => {
    const { f, grants, roots, server } = setupGranted()
    const tool = server.tools.find(t => t.name === 'lilbot_skill_manage')!
    const gHook = grants.ensure({ ownerKey: 'webhook:w-conc', botId: 'b1', scope: { kind: 'webhook', runId: 'w-conc', capabilities: ALL_CAPS } })
    grants.bindChat(gHook.id, 'hook-chat')
    roots.set('hook-child', 'hook-chat')
    roots.set('unreadable-chat', null)

    const createArgs = { action: 'create', name: 'direct-inject', content: SKILL_DOC('direct-inject') }
    for (const ctx of [
      { sessionBound: true },
      { checkId: 'ck-1' },
      { review: true },
      { capabilities: [] },
      { capabilities: ALL_CAPS },
      { chatId: 'hook-chat' },
      { chatId: 'hook-child' },
      { chatId: 'unreadable-chat' }
    ]) {
      await expect(tool.run('b1', createArgs, createArgs, ctx)).rejects.toThrow('Limited sessions cannot write')
    }

    // Concurrent main-chat set_enabled on /engine/lilbot/mcp leaves the scoped webhook endpoint unable to inject a skill.
    f.calls.saw('b1', 'b1-main', 'mcp__lilbot_system__lilbot_skill_manage', { action: 'set_enabled', name: 'existing', enabled: false }, 'req-1')
    const tok = sessionGrantToken(TOKEN, 'b1', gHook.id)
    const hookAttempt = await scopedRpc(server.scoped!, gHook.id, tok, 'tools/call', { name: 'lilbot_skill_manage', arguments: createArgs })
    expect(refusedText(hookAttempt)).toContain('Limited sessions cannot write')
    expect(f.skills.list('b1').some(s => s.name === 'direct-inject')).toBe(false)

    // Full-access main chat still succeeds even while grants exist and main lineage lookup is unreadable.
    roots.set('b1-main', null)
    const ok = await tool.run('b1', { action: 'create', name: 'main-ok', content: SKILL_DOC('main-ok') }, undefined, { capabilities: null, chatId: 'b1-main' })
    expect(ok).toMatchObject({ ok: true, name: 'main-ok' })
  })
})
