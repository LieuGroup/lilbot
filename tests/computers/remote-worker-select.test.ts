import { expect, test } from 'bun:test'
import { validateModelForDriver } from '../../server/computers/remote-worker-sanitize'
import { isSupportedWorkerAgent, selectRemoteWorkerEngine } from '../../server/computers/remote-worker-select'
import { WorkerAgentInfo } from '../../shared/worker-frame-schema'

test('selectRemoteWorkerEngine picks the bot own engine when supported, without assuming hermes', () => {
  const both = [
    { driver: 'hermes' as const, version: '0.23.1', supported: true, signedIn: true },
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: both })).toEqual({
    ok: true,
    driver: 'hermes',
    fallback: false
  })
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'claude-code', agents: both })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: false
  })
})

test('selectRemoteWorkerEngine falls back deterministically when own engine is absent or unsupported', () => {
  // Own engine absent: falls back to only supported engine.
  const onlyClaude = [
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true },
    { driver: 'codex' as const, version: '0.170.0', supported: false, signedIn: true }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: onlyClaude })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: true,
    fallbackFrom: 'hermes'
  })

  // Own engine installed but unsupported: falls back to a supported engine.
  const unsupportedOwn = [
    { driver: 'hermes' as const, version: '0.23.1', supported: false, signedIn: true },
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: unsupportedOwn })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: true,
    fallbackFrom: 'hermes'
  })

  // Multiple supported fallback engines: prefers model-compatible, then signedIn (true > unknown > false), then deterministic order.
  const multi = [
    { driver: 'codex' as const, version: '0.170.0', supported: true, signedIn: true },
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: false }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: multi })).toEqual({
    ok: true,
    driver: 'codex',
    fallback: true,
    fallbackFrom: 'hermes'
  })
  expect(
    selectRemoteWorkerEngine({
      computerName: 'Box',
      botEngineId: 'hermes',
      agents: multi,
      requestedModel: { provider: 'anthropic', model: 'claude-sonnet-5-5' }
    })
  ).toEqual({ ok: true, driver: 'claude-code', fallback: true, fallbackFrom: 'hermes' })
})

test('selectRemoteWorkerEngine honors explicit engine requests and never silently falls back', () => {
  const agents = [
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true },
    { driver: 'codex' as const, version: '0.170.0', supported: false, signedIn: true }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents, requestedEngine: 'claude-code' })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: false
  })
  const missing = selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents, requestedEngine: 'hermes' })
  expect(missing.ok).toBe(false)
  if (!missing.ok) {
    expect(missing.code).toBe('engine_unavailable')
    expect(missing.message).toContain('claude-code')
  }
  const unsupported = selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents, requestedEngine: 'codex' })
  expect(unsupported.ok).toBe(false)
  if (!unsupported.ok) expect(unsupported.code).toBe('engine_unsupported')

  const noneSupported = selectRemoteWorkerEngine({
    computerName: 'Box',
    botEngineId: 'hermes',
    agents: [{ driver: 'codex', version: '0.170.0', supported: false }]
  })
  expect(noneSupported.ok).toBe(false)
  if (!noneSupported.ok) {
    expect(noneSupported.code).toBe('computer_no_worker')
    expect(noneSupported.message).toContain('codex')
  }
})

test('older helper entries without supported/signedIn parse cleanly and count as supported', () => {
  const legacy = WorkerAgentInfo.parse({ driver: 'claude-code', version: '2.1.327' })
  expect(isSupportedWorkerAgent(legacy)).toBe(true)
  expect(selectRemoteWorkerEngine({ computerName: 'Legacy', botEngineId: 'hermes', agents: [legacy] })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: true,
    fallbackFrom: 'hermes'
  })
})

test('validateModelForDriver validates models per driver and carries fallback context', () => {
  expect(validateModelForDriver({ provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }, 'hermes')).toEqual({
    ok: true,
    driver: 'hermes',
    wireModel: 'anthropic/claude-sonnet-5-5',
    provider: 'cliproxyapi'
  })
  expect(validateModelForDriver({ provider: 'openrouter', model: 'google/gemini-4-neon' }, 'hermes').ok).toBe(true)
  expect(validateModelForDriver({ provider: 'openai', model: 'openai/gpt-5.3-codex' }, 'codex')).toEqual({
    ok: true,
    driver: 'codex',
    wireModel: 'gpt-5.3-codex'
  })
  expect(validateModelForDriver({ provider: 'anthropic', model: 'anthropic/claude-sonnet-5-5' }, 'codex').ok).toBe(false)
  const fallbackErr = validateModelForDriver(
    { provider: 'openrouter', model: 'google/gemini-4-neon' },
    'claude-code',
    'Your engine (hermes) is not available on "Box", so LilBot fell back to claude-code.'
  )
  expect(fallbackErr.ok).toBe(false)
  if (!fallbackErr.ok) expect(fallbackErr.message).toContain('fell back to claude-code')
})
