import { expect, test } from 'bun:test'
import { buildClaudeArgs, createClaudeStreamState, parseClaudeLine } from '../../helper/worker-claude-protocol'

test('buildClaudeArgs emits exact Claude Code flags and omits optional ones when absent', () => {
  const minimal = buildClaudeArgs({ runId: 'r1', cwd: '/tmp/work', model: 'claude-sonnet-5-5', prompt: 'hi' }, '/tmp/r1.mcp.json')
  expect(minimal).toEqual([
    '-p',
    '--output-format',
    'stream-json',
    '--input-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'bypassPermissions',
    '--strict-mcp-config',
    '--mcp-config',
    '/tmp/r1.mcp.json',
    '--model',
    'claude-sonnet-5-5'
  ])
  expect(minimal).not.toContain('--no-session-persistence')

  const full = buildClaudeArgs(
    {
      runId: 'r2',
      sessionId: 'sess-123',
      cwd: '/tmp/work',
      model: 'claude-opus-5-5',
      reasoningEffort: 'high',
      systemPrompt: 'Stay concise.',
      prompt: 'continue'
    },
    '/tmp/r2.mcp.json'
  )
  expect(full).toContain('--effort')
  expect(full[full.indexOf('--effort') + 1]).toBe('high')
  expect(full).toContain('--append-system-prompt')
  expect(full[full.indexOf('--append-system-prompt') + 1]).toBe('Stay concise.')
  expect(full).toContain('--resume')
  expect(full[full.indexOf('--resume') + 1]).toBe('sess-123')
})

test('parseClaudeLine handles Claude Code 2.1.327 stream-json events, usage, model refusal, and secret scrubbing', () => {
  const secret = 'ephemeral-token-secret-xyz'
  const state = createClaudeStreamState()

  expect(parseClaudeLine('not-json', state, secret)).toBeNull()
  expect(parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'sess-42' }), state, secret)).toEqual({
    sessionId: 'sess-42',
    activity: 'Starting...'
  })
  expect(parseClaudeLine(JSON.stringify({ type: 'rate_limit_event', session_id: 'sess-42' }), state, secret)).toEqual({
    sessionId: 'sess-42',
    activity: 'Waiting for rate limit...'
  })

  const toolUse = parseClaudeLine(
    JSON.stringify({
      type: 'assistant',
      session_id: 'sess-42',
      message: {
        content: [
          { type: 'thinking', thinking: 'planning' },
          { type: 'tool_use', id: 'tu-1', name: 'mcp__lilbot_system__lilbot_work', input: { command: `check ${secret}` } }
        ]
      }
    }),
    state,
    secret
  )
  expect(toolUse?.tools).toEqual([{ toolId: 'tu-1', name: 'mcp__lilbot_system__lilbot_work', detail: 'check [redacted]', running: true }])
  expect(JSON.stringify(toolUse)).not.toContain(secret)

  const toolRes = parseClaudeLine(
    JSON.stringify({
      type: 'user',
      session_id: 'sess-42',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: [{ type: 'text', text: `ok ${secret}` }], is_error: false }]
      }
    }),
    state,
    secret
  )
  expect(toolRes?.tools).toEqual([{ toolId: 'tu-1', name: 'mcp__lilbot_system__lilbot_work', detail: 'check [redacted]', running: false, failed: false }])
  expect(state.items[0]).toMatchObject({ kind: 'tool', toolId: 'tu-1', running: false, failed: false, result: 'ok [redacted]' })

  const done = parseClaudeLine(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      session_id: 'sess-42',
      result: 'All tests passed.',
      usage: { input_tokens: 120, cache_read_input_tokens: 500, cache_creation_input_tokens: 40, output_tokens: 35 },
      modelUsage: { 'claude-sonnet-5-5': { contextWindow: 200_000 } }
    }),
    state,
    secret
  )
  expect(done?.textPreview).toBe('All tests passed.')
  expect(state.resultSeen).toBe(true)
  expect(state.resultText).toBe('All tests passed.')
  expect(state.usage).toEqual({ inputTokens: 120, cacheReadTokens: 500, cacheWriteTokens: 40, outputTokens: 35, contextWindow: 200_000 })

  const refused = createClaudeStreamState()
  parseClaudeLine(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: `Model rejected (${secret})` }), refused, secret)
  expect(refused.resultError).toBe('Model rejected ([redacted])')
})
