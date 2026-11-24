import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hermesToolsetsForRun, limitedNeedsFileEdits } from '../../../server/engines/hermes/hermes-access'
import { reviewMemory } from '../../../server/engines/hermes/hermes-memory-review'
import { knownAcpPluginToolsets } from '../../../server/engines/hermes/hermes-skills'
import type { McpConnection } from '../../../server/engines/mcp-connection'

const CONN: McpConnection = {
  name: 'lilbot',
  url: 'http://127.0.0.1:3370/engine/lilbot/session/11111111-1111-4111-8111-111111111111/mcp',
  bearerToken: 'review-token',
  timeoutSeconds: 30,
  tools: ['lilbot_memory_recall', 'lilbot_memory_save', 'lilbot_memory_forget']
}

function makeConnect(opts: { enabledToolsets?: string[]; sections?: { name: string; tools: { name: string }[] }[] | null; completeStatus?: string; emitApproval?: boolean } = {}) {
  const calls: { method: string; params: any }[] = []
  let closed = false
  const connect: any = async (_profile: string, onEvent: (event: any) => void) => {
    const socket: any = {
      close: () => {
        closed = true
      },
      request: async (method: string, params: any) => {
        calls.push({ method, params })
        if (method === 'config.get') return { value: 'off' }
        if (method === 'session.create') return { session_id: 'live-1', stored_session_id: 'stored-1', revision: 1, execution_generation: 0 }
        if (method === 'session.info') return { enabled_toolsets: opts.enabledToolsets ?? ['context_engine', 'mcp-editor_lilbot_a1b2c3d4'] }
        if (method === 'tools.show') {
          return opts.sections === null ? {} : { sections: opts.sections ?? [] }
        }
        if (method === 'prompt.submit') {
          if (opts.emitApproval) onEvent({ type: 'approval.prompt', payload: { prompt_id: 'p-1', execution_generation: 1 } })
          queueMicrotask(() => onEvent({ type: 'message.complete', payload: { status: opts.completeStatus ?? 'complete' } }))
        }
        return { ok: true }
      }
    }
    return socket
  }
  return { connect, calls, isClosed: () => closed }
}

describe('Hermes reviewMemory isolated session lifecycle', () => {
  test('review scope denies file edits, requests context_engine + no_mcp, and fails closed without sessionMcp', async () => {
    expect(limitedNeedsFileEdits('review')).toBe(false)
    expect(hermesToolsetsForRun('review')).toEqual(['context_engine', 'no_mcp'])
    const dir = mkdtempSync(join(tmpdir(), 'known-acp-'))
    try {
      expect(knownAcpPluginToolsets(dir)).toEqual(['skills'])
      writeFileSync(join(dir, 'config.yaml'), 'known_plugin_toolsets:\n  acp:\n    - custom_plugin\n    - skills\n')
      expect(knownAcpPluginToolsets(dir)).toEqual(['custom_plugin', 'skills'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    await expect(reviewMemory('bot-1', 'Review', { onChat: () => {} })).rejects.toMatchObject({ code: 'session_mcp_unavailable' })
  })

  test('runs on ACP with context_engine + no_mcp, ignore_rules, canonical onChat order, and immediate approval denial', async () => {
    const { connect, calls, isClosed } = makeConnect({ emitApproval: true })
    const chats: string[] = []
    let readyCalled = 0
    await reviewMemory(
      'bot-1',
      'Review prompt',
      {
        workspace: '/tmp/ws',
        model: { provider: 'p', model: 'm' },
        sessionMcp: [CONN],
        assertSessionMcpReady: () => void readyCalled++,
        onChat: id => chats.push(id)
      },
      connect
    )
    expect(readyCalled).toBe(1)
    expect(chats).toEqual(['stored-1', 'live-1'])
    const create = calls.find(c => c.method === 'session.create')!
    expect(create.params).toMatchObject({
      source: 'acp',
      hidden: true,
      yolo: true,
      ignore_rules: true,
      cwd: '/tmp/ws',
      toolsets: ['context_engine', 'no_mcp'],
      model: 'm',
      provider: 'p'
    })
    expect(calls.some(c => c.method === 'approval.respond' && c.params.choice === 'deny')).toBe(true)
    expect(isClosed()).toBe(true)
  })

  test('fails closed before prompt.submit if Hermes attaches skills toolset or non-complete status returns', async () => {
    const withSkills = makeConnect({
      enabledToolsets: ['skills', 'mcp-editor_lilbot_a1b2c3d4'],
      sections: [
        { name: 'skills', tools: [{ name: 'skills_list' }, { name: 'skill_view' }, { name: 'skill_manage' }] },
        { name: 'mcp-editor_lilbot_a1b2c3d4', tools: [{ name: 'mcp__editor_lilbot_a1b2c3d4__lilbot_memory_save' }] }
      ]
    })
    await expect(reviewMemory('bot-1', 'Review', { workspace: '/tmp/ws', sessionMcp: [CONN], onChat: () => {} }, withSkills.connect)).rejects.toMatchObject({
      code: 'session_scope_violation'
    })
    expect(withSkills.calls.some(c => c.method === 'prompt.submit')).toBe(false)
    expect(withSkills.isClosed()).toBe(true)

    const malformed = makeConnect({ sections: null })
    await expect(reviewMemory('bot-1', 'Review', { workspace: '/tmp/ws', sessionMcp: [CONN], onChat: () => {} }, malformed.connect)).rejects.toMatchObject({
      code: 'session_scope_violation'
    })
    expect(malformed.calls.some(c => c.method === 'prompt.submit')).toBe(false)

    const failed = makeConnect({ completeStatus: 'error' })
    await expect(reviewMemory('bot-1', 'Review', { workspace: '/tmp/ws', sessionMcp: [CONN], onChat: () => {} }, failed.connect)).rejects.toMatchObject({ code: 'review_failed' })
    expect(failed.isClosed()).toBe(true)
  })
})
