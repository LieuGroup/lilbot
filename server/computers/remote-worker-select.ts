/** Engine selection for remote coding workers. Pure and engine-neutral: matches the bot's own engine when supported
 *  on the target computer, falls back deterministically otherwise, and never silently falls back on explicit requests. */
import type { BotModel } from '../../shared/bot-schema'
import type { WorkerAgentInfo, WorkerDriverId } from '../../shared/worker-frame-schema'
import { validateModelForDriver } from './remote-worker-sanitize'

const FALLBACK_ENGINE_ORDER: readonly WorkerDriverId[] = ['hermes', 'claude-code', 'codex']

/** Older helpers omit `supported` and report only runnable drivers, so omitted `supported` counts as true. */
export const isSupportedWorkerAgent = (agent: WorkerAgentInfo): boolean => agent.supported !== false

const signInRank = (signedIn?: boolean) => (signedIn === true ? 2 : signedIn === undefined ? 1 : 0)
const orderOf = (driver: WorkerDriverId) => {
  const index = FALLBACK_ENGINE_ORDER.indexOf(driver)
  return index >= 0 ? index : FALLBACK_ENGINE_ORDER.length
}

export interface RemoteEngineSelectionInput {
  computerName: string
  botEngineId: string
  agents: WorkerAgentInfo[]
  requestedEngine?: WorkerDriverId
  requestedModel?: BotModel | null
}

export type RemoteEngineSelection =
  | { ok: true; driver: WorkerDriverId; fallback: boolean; fallbackFrom?: string }
  | { ok: false; code: 'engine_unavailable' | 'engine_unsupported' | 'computer_no_worker'; message: string }

export function selectRemoteWorkerEngine(input: RemoteEngineSelectionInput): RemoteEngineSelection {
  const { computerName, botEngineId, agents, requestedEngine, requestedModel } = input
  const runnable = agents.filter(isSupportedWorkerAgent)
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
    if (!isSupportedWorkerAgent(match)) {
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
  const chosen = [...candidates].sort((a, b) => signInRank(b.signedIn) - signInRank(a.signedIn) || orderOf(a.driver) - orderOf(b.driver))[0]
  return { ok: true, driver: chosen.driver, fallback: true, fallbackFrom: botEngineId }
}
