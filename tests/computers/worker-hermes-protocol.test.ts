import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hasCheckpointRequired, hermesToolsets, scrubHermesEnv } from '../../helper/drivers/hermes/worker-hermes-env'
import { cleanHermesError, resolveHermesModel, stripEditorMcpPrefix } from '../../helper/drivers/hermes/worker-hermes-model'
import { applyHermesEvent, createHermesStreamState, mapHermesTranscript, seedHermesUsage } from '../../helper/drivers/hermes/worker-hermes-protocol'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

test('resolveHermesModel matches direct/cross providers, falls back to machine default, and fails fast when unsigned', () => {
  const noAuth = resolveHermesModel('anthropic/claude-sonnet-5-5', 'cliproxyapi', { providers: [{ slug: 'anthropic', authenticated: false, models: ['claude-sonnet-5-5'] }] })
  expect(noAuth.ok).toBe(false)
  if (!noAuth.ok) expect(noAuth.error).toContain('hermes model')

  // Unauthenticated provider MUST still fail fast even when options.model is non-empty.
  const noAuthWithDefault = resolveHermesModel('anthropic/claude-sonnet-5-5', 'cliproxyapi', {
    providers: [{ slug: 'anthropic', authenticated: false, models: ['claude-sonnet-5-5'] }],
    model: 'claude-sonnet-5-5',
    provider: 'anthropic'
  })
  expect(noAuthWithDefault.ok).toBe(false)
  if (!noAuthWithDefault.ok) expect(noAuthWithDefault.error).toContain('hermes model')

  // Direct provider match (e.g. leader and remote share cliproxyapi)
  expect(
    resolveHermesModel('anthropic/claude-sonnet-5-5', 'cliproxyapi', {
      providers: [{ slug: 'cliproxyapi', authenticated: true, models: ['anthropic/claude-sonnet-5-5'] }]
    })
  ).toEqual({ ok: true, model: 'anthropic/claude-sonnet-5-5', provider: 'cliproxyapi' })

  // Cross-provider match: leader uses cliproxyapi, remote has native anthropic authenticated
  expect(
    resolveHermesModel('anthropic/claude-sonnet-5-5', 'cliproxyapi', {
      providers: [{ slug: 'anthropic', authenticated: true, models: ['claude-sonnet-5-5'] }]
    })
  ).toEqual({ ok: true, model: 'claude-sonnet-5-5', provider: 'anthropic' })

  // Fallback to remote Hermes configured default model when requested model is unavailable there
  const fb = resolveHermesModel('anthropic/claude-sonnet-5-5', 'cliproxyapi', {
    providers: [{ slug: 'openai-codex', authenticated: true, models: ['gpt-5'] }],
    model: 'gpt-5',
    provider: 'openai-codex'
  })
  expect(fb.ok).toBe(true)
  if (fb.ok) {
    expect(fb.model).toBeUndefined()
    expect(fb.provider).toBeUndefined()
    expect(fb.fallbackNote).toContain('gpt-5')
  }

  // Authenticated provider but no matching model AND no default model configured -> fast fail
  const noDefault = resolveHermesModel('anthropic/claude-sonnet-5-5', 'cliproxyapi', {
    providers: [{ slug: 'openai-codex', authenticated: true, models: ['gpt-5'] }],
    model: ''
  })
  expect(noDefault.ok).toBe(false)
  if (!noDefault.ok) expect(noDefault.error).toContain('no default model')
})

test('hermesToolsets always passes no_mcp, carries narrowed capabilities, and scrubHermesEnv drops stray HERMES_* vars', () => {
  expect(hermesToolsets(undefined)).toEqual(['terminal', 'file', 'web', 'code_execution', 'todo', 'no_mcp'])
  expect(hermesToolsets(['computers'])).toEqual(['no_mcp'])
  expect(hermesToolsets(['computers', 'web'])).toEqual(['no_mcp', 'web'])
  expect(hermesToolsets(['computers', 'shell'])).toEqual(['no_mcp', 'terminal', 'file', 'code_execution'])
  expect(hermesToolsets(['computers', 'shell', 'web'])).toEqual(['no_mcp', 'terminal', 'file', 'code_execution', 'web'])

  const scrubbed = scrubHermesEnv({ PATH: '/usr/bin', HERMES_MODEL: 'leak', HERMES_YOLO: '1', TERMINAL_CWD: '/bad', HOME: '/home/u' }, { hermesHome: '/tmp/h', lockDir: '/tmp/l' })
  expect(scrubbed.HERMES_MODEL).toBeUndefined()
  expect(scrubbed.HERMES_YOLO).toBeUndefined()
  expect(scrubbed.TERMINAL_CWD).toBeUndefined()
  expect(scrubbed.HERMES_HOME).toBe('/tmp/h')
  expect(scrubbed.HERMES_GATEWAY_LOCK_DIR).toBe('/tmp/l')
  expect(scrubbed.PATH).toBe('/usr/bin')
})

test('hasCheckpointRequired reads compression.checkpoint_required without writing files or touching credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-ckpt-'))
  dirs.push(dir)
  const userHome = join(dir, 'user-hermes')
  mkdirSync(userHome, { recursive: true })
  expect(hasCheckpointRequired(userHome)).toBe(false)
  writeFileSync(join(userHome, 'config.yaml'), 'model:\n  default: claude-sonnet-5-5\ncompression:\n  checkpoint_required: false\n')
  expect(hasCheckpointRequired(userHome)).toBe(false)
  writeFileSync(join(userHome, 'config.yaml'), 'compression:\n  checkpoint_required: true\n')
  expect(hasCheckpointRequired(userHome)).toBe(true)
  writeFileSync(join(userHome, 'config.yaml'), 'compression:\n  checkpoint_required: "yes"\n')
  expect(hasCheckpointRequired(userHome)).toBe(true)
  expect(readdirSync(dir)).toEqual(['user-hermes'])
})

test('applyHermesEvent and mapHermesTranscript strip editor MCP prefixes, compute usage deltas, and redact secrets', () => {
  const secret = 'tok_super_secret_999'
  expect(stripEditorMcpPrefix('mcp__editor_lilbot_system_a1b2c3d4__lilbot_work')).toBe('lilbot_work')
  expect(cleanHermesError(`Missing key ${secret} (Advanced: put a key in /home/alice/.hermes/.env)`, secret)).toBe('Missing key [redacted]')

  const state = createHermesStreamState('local-1')
  seedHermesUsage(state, { input_tokens: 100, output_tokens: 40, cache_read_tokens: 10, cache_write_tokens: 5, context_length: 200_000 }, false)

  const startEv = applyHermesEvent(
    state,
    { type: 'tool.start', payload: { tool_id: 't1', name: 'mcp__editor_lilbot_system_00ff11aa__lilbot_work', args: { command: `curl -H ${secret}` } } },
    secret
  )
  expect(startEv?.tools?.[0]).toEqual({ toolId: 't1', name: 'lilbot_work', detail: 'curl -H [redacted]', running: true })

  const doneTool = applyHermesEvent(state, { type: 'tool.complete', payload: { tool_id: 't1', result: JSON.stringify({ ok: false, error: `bad ${secret}` }) } }, secret)
  expect(doneTool?.tools?.[0]?.failed).toBe(true)
  expect(state.tools.get('t1')?.result).not.toContain(secret)

  applyHermesEvent(state, { type: 'message.delta', payload: { text: `Answer with ${secret}` } }, secret)
  applyHermesEvent(state, { type: 'session.usage', payload: { input_tokens: 250, output_tokens: 90, cache_read_tokens: 30, cache_write_tokens: 5, context_tokens: 1200 } }, secret)
  applyHermesEvent(
    state,
    {
      type: 'message.complete',
      payload: { status: 'complete', text: `Final ${secret}`, usage: { input: 250, output: 90, cache_read: 30, cache_write: 5, context_used: 1200, context_max: 200_000 } }
    },
    secret
  )

  expect(state.complete).toEqual({ status: 'completed', text: 'Final [redacted]' })
  expect(state.usage).toEqual({ inputTokens: 150, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 0, contextTokens: 1200, contextWindow: 200_000 })

  const mapped = mapHermesTranscript(
    [
      { role: 'user', text: 'old' },
      { role: 'assistant', text: 'old reply' },
      { role: 'tool', tool_call_id: 't2', name: 'mcp__editor_lilbot_system_deadbeef__lilbot_memory_save', context: `save ${secret}`, content: `saved ${secret}` },
      { role: 'assistant', text: `done ${secret}` }
    ],
    2,
    secret
  )
  expect(mapped).toEqual([
    { kind: 'tool', toolId: 't2', name: 'lilbot_memory_save', detail: 'save [redacted]', running: false, failed: false, result: 'saved [redacted]' },
    { kind: 'assistant', text: 'done [redacted]' }
  ])
})
