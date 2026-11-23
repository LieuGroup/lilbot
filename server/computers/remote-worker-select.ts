/** Engine selection and server-side normalization for remote coding workers.
 *  Pure and engine-neutral: the server decides which drivers are runnable, matches the bot's own engine when supported
 *  on the target computer, falls back deterministically otherwise, and never silently falls back on explicit requests. */
import type { BotModel } from '../../shared/bot-schema'
import type { ComputerHello } from '../../shared/computer-schema'
import { SAFE_WORKER_VERSION, type WorkerAgentInfo, type WorkerDriverId } from '../../shared/worker-frame-schema'
import { driverPriority, isLegacyImplicitDriver, SERVER_SUPPORTED_WORKER_DRIVERS } from './remote-worker-drivers'
import { validateModelForDriver } from './remote-worker-sanitize'

export { SERVER_SUPPORTED_WORKER_DRIVERS }

/** Drops any version outside the strict `SAFE_WORKER_VERSION` charset to `'unknown'`. */
export function sanitizeWorkerVersion(version: string): string {
  const trimmed = version.trim()
  return SAFE_WORKER_VERSION.test(trimmed) ? trimmed : 'unknown'
}

/** Server-authoritative runnability check: the server must support the driver AND the helper must report it supported
 *  (omitted `supported` counts as true only for a legacy driver older helpers reported before adding `supported`). */
export function isSupportedWorkerAgent(agent: WorkerAgentInfo, serverDrivers: ReadonlySet<WorkerDriverId> = SERVER_SUPPORTED_WORKER_DRIVERS): boolean {
  if (!serverDrivers.has(agent.driver)) return false
  return agent.supported ?? isLegacyImplicitDriver(agent.driver)
}

/** Deduplicates by driver, enforces strict version sanitization, and overrides helper `supported` claims the server cannot run. */
export function normalizeWorkerAgents(agents: WorkerAgentInfo[] | undefined, serverDrivers: ReadonlySet<WorkerDriverId> = SERVER_SUPPORTED_WORKER_DRIVERS): WorkerAgentInfo[] {
  if (!agents?.length) return []
  const out: WorkerAgentInfo[] = []
  const seen = new Set<WorkerDriverId>()
  for (const agent of agents) {
    if (seen.has(agent.driver)) continue
    seen.add(agent.driver)
    const runnable = isSupportedWorkerAgent(agent, serverDrivers)
    out.push({
      ...agent,
      version: sanitizeWorkerVersion(agent.version),
      ...(agent.supported !== undefined || !runnable ? { supported: runnable } : {})
    })
  }
  return out
}

/** Reconciles stored `capabilities` and `workerAgents` against what this server can actually run. */
export function reconcileWorkerCapabilities(
  hello: ComputerHello,
  incomingAgents?: WorkerAgentInfo[],
  serverDrivers: ReadonlySet<WorkerDriverId> = SERVER_SUPPORTED_WORKER_DRIVERS
): ComputerHello {
  const agents = normalizeWorkerAgents(incomingAgents ?? hello.workerAgents, serverDrivers)
  const baseCaps = hello.capabilities.filter(cap => cap !== 'worker')
  const hasRunnable = agents.some(agent => isSupportedWorkerAgent(agent, serverDrivers))
  const { workerAgents: _prev, ...rest } = hello
  return {
    ...rest,
    capabilities: hasRunnable ? ([...baseCaps, 'worker'] as ComputerHello['capabilities']) : baseCaps,
    ...(agents.length ? { workerAgents: agents } : {})
  }
}

const signInRank = (signedIn?: boolean) => (signedIn === true ? 2 : signedIn === undefined ? 1 : 0)

export interface RemoteEngineSelectionInput {
  computerName: string
  botEngineId: string
  agents: WorkerAgentInfo[]
  requestedEngine?: WorkerDriverId
  requestedModel?: BotModel | null
  supportedDrivers?: ReadonlySet<WorkerDriverId>
}

export type RemoteEngineSelection =
  | { ok: true; driver: WorkerDriverId; fallback: boolean; fallbackFrom?: string }
  | { ok: false; code: 'engine_unavailable' | 'engine_unsupported' | 'computer_no_worker'; message: string }

export function selectRemoteWorkerEngine(input: RemoteEngineSelectionInput): RemoteEngineSelection {
  const { computerName, botEngineId, requestedEngine, requestedModel } = input
  const serverDrivers = input.supportedDrivers ?? SERVER_SUPPORTED_WORKER_DRIVERS
  const agents = normalizeWorkerAgents(input.agents, serverDrivers)
  const runnable = agents.filter(agent => isSupportedWorkerAgent(agent, serverDrivers))
  const runnableNames = runnable.map(a => a.driver).join(', ')

  if (requestedEngine) {
    const match = agents.find(a => a.driver === requestedEngine)
    if (!match) {
      return {
        ok: false,
        code: 'engine_unavailable',
        message: `Computer "${computerName}" does not have "${requestedEngine}" installed.${runnableNames ? ` Supported engines there: ${runnableNames}.` : ' No supported coding engine is installed there.'}`
      }
    }
    if (!isSupportedWorkerAgent(match, serverDrivers)) {
      return {
        ok: false,
        code: 'engine_unsupported',
        message: `Computer "${computerName}" has "${requestedEngine}" installed, but LilBot does not support running workers on it yet.${runnableNames ? ` Supported engines there: ${runnableNames}.` : ''}`
      }
    }
    return { ok: true, driver: match.driver, fallback: false }
  }

  if (!runnable.length) {
    const unsupported = agents.map(a => a.driver).join(', ')
    return {
      ok: false,
      code: 'computer_no_worker',
      message: unsupported
        ? `Computer "${computerName}" has ${unsupported} installed, but LilBot does not support running workers on ${agents.length === 1 ? 'it' : 'them'} yet.`
        : `Computer "${computerName}" does not advertise a coding agent.`
    }
  }

  const own = runnable.find(a => a.driver === botEngineId)
  if (own) return { ok: true, driver: own.driver, fallback: false }

  let candidates = runnable
  if (requestedModel) {
    const compatible = candidates.filter(a => validateModelForDriver(requestedModel, a.driver).ok)
    if (compatible.length) candidates = compatible
  }
  const chosen = [...candidates].sort(
    (a, b) => signInRank(b.signedIn) - signInRank(a.signedIn) || driverPriority(a.driver) - driverPriority(b.driver) || a.driver.localeCompare(b.driver)
  )[0]
  return { ok: true, driver: chosen.driver, fallback: true, fallbackFrom: botEngineId }
}
