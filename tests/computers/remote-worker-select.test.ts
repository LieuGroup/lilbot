import { expect, test } from 'bun:test'
import type { ServerWorkerDriverSpec } from '../../server/computers/remote-worker-drivers'
import { validateModelForDriver } from '../../server/computers/remote-worker-sanitize'
import { isSupportedWorkerAgent, normalizeWorkerAgents, SERVER_SUPPORTED_WORKER_DRIVERS, selectRemoteWorkerEngine } from '../../server/computers/remote-worker-select'
import { WorkerAgentInfo, type WorkerDriverId } from '../../shared/worker-frame-schema'

const ALL_DRIVERS: ReadonlySet<WorkerDriverId> = new Set(['hermes', 'claude-code', 'codex'])

test('server decides runnability: accepts hermes and claude-code, rejects server-unsupported drivers, and degrades cleanly on older servers', () => {
  expect(SERVER_SUPPORTED_WORKER_DRIVERS.has('claude-code')).toBe(true)
  expect(SERVER_SUPPORTED_WORKER_DRIVERS.has('hermes')).toBe(true)
  expect(SERVER_SUPPORTED_WORKER_DRIVERS.has('codex')).toBe(false)

  // Buggy/hostile helper claiming supported=true for codex is NOT runnable on this server; hermes with supported=true IS.
  expect(isSupportedWorkerAgent({ driver: 'hermes', version: '0.23.1', supported: true })).toBe(true)
  expect(isSupportedWorkerAgent({ driver: 'codex', version: '0.171.0', supported: true })).toBe(false)
  // Older server release (claude-code only) still rejects helper-claimed hermes cleanly and falls back to claude-code.
  const olderServer: ReadonlySet<WorkerDriverId> = new Set(['claude-code'])
  expect(isSupportedWorkerAgent({ driver: 'hermes', version: '0.23.1', supported: true }, olderServer)).toBe(false)
  // Omitted supported counts as true ONLY for legacy claude-code, never hermes/codex even when server supports them.
  expect(isSupportedWorkerAgent({ driver: 'claude-code', version: '2.1.327' })).toBe(true)
  expect(isSupportedWorkerAgent({ driver: 'hermes', version: '0.23.1' }, ALL_DRIVERS)).toBe(false)
  expect(isSupportedWorkerAgent({ driver: 'codex', version: '0.171.0' }, ALL_DRIVERS)).toBe(false)

  const both = [
    { driver: 'hermes' as const, version: '0.23.1', supported: true, signedIn: true },
    { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true }
  ]
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: both })).toEqual({
    ok: true,
    driver: 'hermes',
    fallback: false
  })
  // Older server without hermes falls back to claude-code and refuses explicit hermes cleanly.
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: both, supportedDrivers: olderServer })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: true,
    fallbackFrom: 'hermes'
  })
  const explicitOlder = selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: both, requestedEngine: 'hermes', supportedDrivers: olderServer })
  expect(explicitOlder.ok).toBe(false)
  if (!explicitOlder.ok) expect(explicitOlder.code).toBe('engine_unsupported')
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

  // Declarative registry: a new driver spec works purely from data, with no driver-name branches.
  const custom = new Map<WorkerDriverId, ServerWorkerDriverSpec>([
    ['pi', { id: 'pi', supported: true, priority: 0, modelRule: { kind: 'prefixed-family', prefix: 'acme/', family: /^pi-/i, label: 'Pi models only' } }]
  ])
  expect(validateModelForDriver({ provider: 'acme', model: 'acme/pi-fast' }, 'pi', undefined, custom)).toEqual({ ok: true, driver: 'pi', wireModel: 'pi-fast' })
  expect(validateModelForDriver({ provider: 'other', model: 'other/model' }, 'pi', undefined, custom).ok).toBe(false)
})

test('unknown future driver ids pass strict charset validation and report as found, not supported', () => {
  const future = WorkerAgentInfo.parse({ driver: 'pi-agent', version: '0.4.2', supported: true, signedIn: true })
  expect(isSupportedWorkerAgent(future)).toBe(false)
  expect(normalizeWorkerAgents([future])).toEqual([{ driver: 'pi-agent', version: '0.4.2', supported: false, signedIn: true }])
  const sel = selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: [future] })
  expect(sel.ok).toBe(false)
  if (!sel.ok) {
    expect(sel.code).toBe('computer_no_worker')
    expect(sel.message).toContain('pi-agent')
  }
  const explicit = selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: [future], requestedEngine: 'pi-agent' })
  expect(explicit.ok).toBe(false)
  if (!explicit.ok) expect(explicit.code).toBe('engine_unsupported')

  for (const bad of ['', '-dash', 'UPPER', 'bad space', 'a/b', '1num', 'a'.repeat(33)]) {
    expect(WorkerAgentInfo.safeParse({ driver: bad, version: '1.0.0' }).success).toBe(false)
  }
})
