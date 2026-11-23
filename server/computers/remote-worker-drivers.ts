/** Declarative server-side registry of coding-agent worker drivers.
 *  Adding a new driver is one entry here (and one driver file + registration in `helper/worker-driver.ts`).
 *  Both engine selection (`remote-worker-select.ts`) and model validation (`remote-worker-sanitize.ts`) read this data. */
import type { WorkerDriverId } from '../../shared/worker-frame-schema'

type WorkerModelRule =
  /** Driver accepts any safe raw model name plus an optional provider id. */
  | { kind: 'any-with-optional-provider' }
  /** Driver accepts one provider prefix (stripped on the wire) and a strict model-family pattern. */
  | { kind: 'prefixed-family'; prefix: string; family: RegExp; label: string }

export interface ServerWorkerDriverSpec {
  readonly id: WorkerDriverId
  /** Whether this server release can dispatch remote workers to this driver. */
  readonly supported: boolean
  /** Fallback tie-breaker order (lower number preferred when the bot's own engine is unavailable). */
  readonly priority: number
  /** Model compatibility and wire-model normalization rule for this driver. */
  readonly modelRule: WorkerModelRule
  /** True only for the single driver older helpers advertised before adding the explicit `supported` flag. */
  readonly legacyImplicit?: boolean
}

const SERVER_WORKER_DRIVERS: readonly ServerWorkerDriverSpec[] = [
  {
    id: 'hermes',
    supported: true,
    priority: 0,
    modelRule: { kind: 'any-with-optional-provider' }
  },
  {
    id: 'claude-code',
    supported: true,
    priority: 1,
    legacyImplicit: true,
    modelRule: {
      kind: 'prefixed-family',
      prefix: 'anthropic/',
      family: /^(claude[-_.]|opus$|sonnet$|haiku$)/i,
      label: 'Claude models only'
    }
  },
  {
    id: 'codex',
    supported: false,
    priority: 2,
    modelRule: {
      kind: 'prefixed-family',
      prefix: 'openai/',
      family: /^(gpt[-_.]|o[134]($|[-_.])|codex)/i,
      label: 'OpenAI/Codex models only'
    }
  }
]

export const SERVER_WORKER_DRIVER_MAP: ReadonlyMap<WorkerDriverId, ServerWorkerDriverSpec> = new Map(SERVER_WORKER_DRIVERS.map(spec => [spec.id, spec]))

/** Drivers this server release knows how to dispatch to remote helpers (derived from `SERVER_WORKER_DRIVERS`). */
export const SERVER_SUPPORTED_WORKER_DRIVERS: ReadonlySet<WorkerDriverId> = new Set(SERVER_WORKER_DRIVERS.filter(spec => spec.supported).map(spec => spec.id))

export function isLegacyImplicitDriver(driver: WorkerDriverId, specs: ReadonlyMap<WorkerDriverId, ServerWorkerDriverSpec> = SERVER_WORKER_DRIVER_MAP): boolean {
  return specs.get(driver)?.legacyImplicit === true
}

export function driverPriority(driver: WorkerDriverId, specs: ReadonlyMap<WorkerDriverId, ServerWorkerDriverSpec> = SERVER_WORKER_DRIVER_MAP): number {
  return specs.get(driver)?.priority ?? Number.MAX_SAFE_INTEGER
}
