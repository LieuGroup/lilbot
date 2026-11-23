import { expect, test } from 'bun:test'
import { validateModelForDriver } from '../../server/computers/remote-worker-sanitize'
import { isSupportedWorkerAgent, SERVER_SUPPORTED_WORKER_DRIVERS, selectRemoteWorkerEngine } from '../../server/computers/remote-worker-select'
import { WorkerAgentInfo, type WorkerDriverId } from '../../shared/worker-frame-schema'

const ALL_DRIVERS: ReadonlySet<WorkerDriverId> = new Set(['hermes', 'claude-code', 'codex'])

test('server decides runnability: rejects helper supported=true on server-unsupported drivers and scopes legacy omitted supported to claude-code', () => {
  expect(SERVER_SUPPORTED_WORKER_DRIVERS.has('claude-code')).toBe(true)
  expect(SERVER_SUPPORTED_WORKER_DRIVERS.has('hermes')).toBe(false)
  expect(SERVER_SUPPORTED_WORKER_DRIVERS.has('codex')).toBe(false)

  // Buggy/hostile helper claiming supported=true for hermes/codex is NOT runnable on this server.
  expect(isSupportedWorkerAgent({ driver: 'hermes', version: '0.23.1', supported: true })).toBe(false)
  expect(isSupportedWorkerAgent({ driver: 'codex', version: '0.171.0', supported: true })).toBe(false)
  // Omitted supported counts as true ONLY for legacy claude-code, never hermes/codex even if server supports them.
  expect(isSupportedWorkerAgent({ driver: 'claude-code', version: '2.1.327' })).toBe(true)
  expect(isSupportedWorkerAgent({ driver: 'hermes', version: '0.23.1' }, ALL_DRIVERS)).toBe(false)
  expect(isSupportedWorkerAgent({ driver: 'codex', version: '0.171.0' }, ALL_DRIVERS)).toBe(false)

  // Selection refuses helper-claimed hermes when server only supports claude-code, falling back to claude-code.
  const spoofed = [
    { driver: 'hermes' as const, version: '0.23.1', supported: true, signedIn: true },
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: spoofed })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: true,
    fallbackFrom: 'hermes'
  })
  const explicitSpoof = selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: spoofed, requestedEngine: 'hermes' })
  expect(explicitSpoof.ok).toBe(false)
  if (!explicitSpoof.ok) expect(explicitSpoof.code).toBe('engine_unsupported')
})

test('selectRemoteWorkerEngine picks the bot own engine when server and helper support it, without assuming hermes', () => {
  const both = [
    { driver: 'hermes' as const, version: '0.23.1', supported: true, signedIn: true },
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: both, supportedDrivers: ALL_DRIVERS })).toEqual({
    ok: true,
    driver: 'hermes',
    fallback: false
  })
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'claude-code', agents: both, supportedDrivers: ALL_DRIVERS })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: false
  })
})

test('selectRemoteWorkerEngine falls back deterministically by model compatibility, sign-in, then fixed order', () => {
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

  // Multiple supported fallback engines: prefers model-compatible (including bot default model), then signedIn, then order.
  const multi = [
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true },
    { driver: 'codex' as const, version: '0.170.0', supported: true, signedIn: false }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: multi, supportedDrivers: ALL_DRIVERS })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: true,
    fallbackFrom: 'hermes'
  })
  expect(
    selectRemoteWorkerEngine({
      computerName: 'Box',
      botEngineId: 'hermes',
      agents: multi,
      requestedModel: { provider: 'openai', model: 'openai/gpt-5.3-codex' },
      supportedDrivers: ALL_DRIVERS
    })
  ).toEqual({ ok: true, driver: 'codex', fallback: true, fallbackFrom: 'hermes' })
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

test('older helper entries without supported/signedIn parse cleanly and count as supported for claude-code', () => {
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
