/** Neutral ops contracts each engine can provide for environment guards and deploy rollbacks.
 *  Kept separate from `BotEngine` so startup guards and the frozen deploy watchdog never start an engine. */

export interface EngineEnvironmentRules {
  readonly engineId: string
  /** Env var -> production path that development mode must refuse (e.g. an engine's production home). */
  protectedDevPaths(): Record<string, string>
  /** Env vars that development mode requires to be set and located under `developmentHome`. */
  readonly requiredDevPathVars: readonly string[]
}

export interface EngineRollbackContext {
  /** Bound, non-deleted `engine_bot_id` values for this engine from the restored database. */
  readonly profiles: readonly string[]
  /** The service unit's printed systemd `Environment` line, or null when systemd could not supply it. */
  readonly printedEnvironment: string | null
  /** Bounded command runner (no shell interpolation, no raw stderr). */
  runCommand(args: string[], timeoutMs?: number, env?: NodeJS.ProcessEnv): Promise<string>
}

export interface EngineRollbackResult {
  cleared: number
  failed: number
}

export interface EngineRollbackHook {
  readonly engineId: string
  /** Runs after the database is restored and before the previous release starts. Never throws. */
  rollback(context: EngineRollbackContext): Promise<EngineRollbackResult>
}

export interface EngineRollbackDescriptor {
  readonly engineId: string
  /** Absolute path to a self-contained module (zero runtime imports outside `node:*`) exporting `rollbackHook`. */
  readonly modulePath: string
}
