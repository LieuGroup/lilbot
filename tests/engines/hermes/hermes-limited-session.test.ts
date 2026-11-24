import { Database } from 'bun:sqlite'
import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hermesToolsetsForRun, limitedNeedsFileEdits } from '../../../server/engines/hermes/hermes-access'
import { readHistoryCatalog } from '../../../server/engines/hermes/hermes-history-catalog'
import { createLimitedSession, resumeLimitedSession } from '../../../server/engines/hermes/hermes-limited-session'
import type { McpConnection } from '../../../server/engines/mcp-connection'

const CONN: McpConnection = {
  name: 'lilbot',
  url: 'http://127.0.0.1:3370/engine/lilbot/session/11111111-1111-4111-8111-111111111111/mcp',
  bearerToken: 'secret-token',
  timeoutSeconds: 30,
  tools: ['lilbot_work', 'lilbot_about']
}

function fakeSocket(overrides: { enabledToolsets?: string[]; sections?: { name: string; tools: { name: string }[] }[] } = {}) {
  const calls: { method: string; params: any }[] = []
  const socket: any = {
    request: async (method: string, params: any) => {
      calls.push({ method, params })
      if (method === 'session.create' || method === 'session.resume') {
        return { session_id: 'sid-1', stored_session_id: 'stored-1', revision: 1, execution_generation: 0 }
      }
      if (method === 'session.info') {
        return { enabled_toolsets: overrides.enabledToolsets ?? ['skills', 'mcp-editor_lilbot_a1b2c3d4'] }
      }
      if (method === 'tools.show') {
        return {
          sections: overrides.sections ?? [
            { name: 'skills', tools: [{ name: 'skills_list' }, { name: 'skill_view' }] },
            { name: 'mcp-editor_lilbot_a1b2c3d4', tools: [{ name: 'mcp__editor_lilbot_a1b2c3d4__lilbot_work' }] }
          ],
          total: 3
        }
      }
      return { ok: true }
    }
  }
  return { socket, calls }
}

describe('Hermes limited-session isolation, verification, and edit policy', () => {
  test('check sessions stay at ask edit policy (never workspace_session or session) while shell webhooks set workspace_session', async () => {
    expect(limitedNeedsFileEdits('check')).toBe(false)
    expect(limitedNeedsFileEdits('review')).toBe(false)
    expect(limitedNeedsFileEdits({ kind: 'webhook', capabilities: ['web'] })).toBe(false)
    expect(limitedNeedsFileEdits({ kind: 'webhook', capabilities: ['shell'] })).toBe(true)
    expect(limitedNeedsFileEdits({ kind: 'narrowed', capabilities: ['shell'] })).toBe(true)
    expect(hermesToolsetsForRun('review')).toEqual(['skills', 'no_mcp'])

    const checkSock = fakeSocket({
      enabledToolsets: ['web', 'vision', 'terminal', 'file', 'skills', 'mcp-editor_lilbot_a1b2c3d4']
    })
    await createLimitedSession(checkSock.socket, { requestId: 'r-check', cwd: '/tmp/ws', access: 'check', sessionMcp: [CONN] })
    const createCall = checkSock.calls.find(c => c.method === 'session.create')!
    expect(createCall.params.source).toBe('acp')
    expect(createCall.params.toolsets).toContain('no_mcp')
    expect(createCall.params.toolsets).toContain('skills')
    expect(createCall.params.editor.edit_approval_policy).toBe('ask')
    expect(checkSock.calls.some(c => c.method === 'session.mutate')).toBe(false)

    const shellSock = fakeSocket({
      enabledToolsets: ['skills', 'terminal', 'code_execution', 'file', 'mcp-editor_lilbot_a1b2c3d4']
    })
    await createLimitedSession(shellSock.socket, {
      requestId: 'r-shell',
      cwd: '/tmp/ws',
      access: { kind: 'webhook', capabilities: ['shell'] },
      sessionMcp: [CONN]
    })
    const mutate = shellSock.calls.find(c => c.method === 'session.mutate')!
    expect(mutate.params.operation).toBe('edit_policy')
    expect(mutate.params.payload).toEqual({ policy: 'workspace_session' })
  })

  test('fails closed on silent partial discovery drop, unexpected x_search/plugin toolset, or leaked MCP/built-in tool', async () => {
    const scope = { kind: 'webhook' as const, capabilities: [] as const }
    // Silent discovery drop (assertSessionMcpReady throws).
    const s1 = fakeSocket()
    await expect(
      createLimitedSession(s1.socket, {
        requestId: 'r1',
        cwd: '/tmp/ws',
        access: scope,
        sessionMcp: [CONN],
        assertSessionMcpReady: () => {
          throw new Error('discovery dropped')
        }
      })
    ).rejects.toThrow(/discovery dropped/)

    // Editor toolset absent in session.info.enabled_toolsets.
    const s2 = fakeSocket({ enabledToolsets: ['skills'] })
    await expect(createLimitedSession(s2.socket, { requestId: 'r2', cwd: '/tmp/ws', access: scope, sessionMcp: [CONN] })).rejects.toThrow(/failed to attach/)

    // Unexpected x_search or plugin or profile MCP toolset.
    for (const leaked of ['x_search', 'custom_plugin', 'mcp-lilbot_system', 'mcp-lilbot_c_gmail', 'memory']) {
      const s = fakeSocket({ enabledToolsets: ['skills', 'mcp-editor_lilbot_a1b2c3d4', leaked] })
      await expect(createLimitedSession(s.socket, { requestId: 'r3', cwd: '/tmp/ws', access: scope, sessionMcp: [CONN] })).rejects.toThrow(/Unexpected toolset/)
    }

    // Unexpected tool in tools.show (built-in or unlisted MCP tool).
    const s4 = fakeSocket({
      sections: [
        { name: 'skills', tools: [{ name: 'terminal' }] },
        { name: 'mcp-editor_lilbot_a1b2c3d4', tools: [{ name: 'mcp__editor_lilbot_a1b2c3d4__lilbot_work' }] }
      ]
    })
    await expect(createLimitedSession(s4.socket, { requestId: 'r4', cwd: '/tmp/ws', access: scope, sessionMcp: [CONN] })).rejects.toThrow(/Unexpected built-in tool/)

    const s5 = fakeSocket({
      sections: [{ name: 'mcp-editor_lilbot_a1b2c3d4', tools: [{ name: 'mcp__editor_lilbot_a1b2c3d4__lilbot_bot_edit' }] }]
    })
    await expect(createLimitedSession(s5.socket, { requestId: 'r5', cwd: '/tmp/ws', access: scope, sessionMcp: [CONN] })).rejects.toThrow(/Unexpected MCP tool/)
  })

  test('resumeLimitedSession re-supplies editor.mcp_servers and re-audits the resumed session', async () => {
    const scope = { kind: 'narrowed' as const, capabilities: [] as const }
    const ok = fakeSocket({ sections: [{ name: 'skills', tools: [{ name: 'skills_list' }, { name: 'skill_view' }] }] })
    await resumeLimitedSession(ok.socket, 'stored-1', [CONN], scope)
    expect(ok.calls.find(c => c.method === 'session.resume')?.params.editor.mcp_servers[0].url).toBe(CONN.url)
    expect(ok.calls.some(c => c.method === 'tools.show')).toBe(true)

    const bad = fakeSocket({ enabledToolsets: ['skills', 'mcp-editor_lilbot_a1b2c3d4', 'x_search'] })
    await expect(resumeLimitedSession(bad.socket, 'stored-1', [CONN], scope)).rejects.toThrow(/Unexpected toolset/)
  })

  test('readHistoryCatalog excludes acp sessions (by source or created_source) and their compression continuations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'acp-hist-'))
    const path = join(dir, 'state.db')
    const db = new Database(path)
    try {
      db.exec('CREATE TABLE sessions(id TEXT, started_at REAL, parent_session_id TEXT, end_reason TEXT, hidden INTEGER, archived INTEGER, source TEXT, created_source TEXT)')
      db.query("INSERT INTO sessions VALUES ('chat-main', 100, NULL, NULL, 0, 0, 'local', 'gui')").run()
      db.query("INSERT INTO sessions VALUES ('acp-root', 200, NULL, 'compression', 1, 0, 'acp', 'acp')").run()
      db.query("INSERT INTO sessions VALUES ('acp-child', 210, 'acp-root', NULL, 0, 0, 'acp', 'acp')").run()
      db.query("INSERT INTO sessions VALUES ('acp-unhidden', 220, NULL, NULL, 0, 0, 'acp', 'acp')").run()
      db.query("INSERT INTO sessions VALUES ('acp-local-row', 230, NULL, NULL, 0, 0, 'local', 'acp')").run()
      expect(readHistoryCatalog(path).map(s => s.id)).toEqual(['chat-main'])
    } finally {
      db.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
