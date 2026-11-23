/** Pure metadata registration for server bot engines (environment rules and deploy rollback hook paths).
 *  Kept free of Bun-only runtime imports so Node-loaded callers (`vite.config.ts` -> `server/environment.ts`,
 *  `knip`, `deploy-cli.ts`) never pull engine runtimes in. Runtime engine instances register in `registry.ts`. */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EngineEnvironmentRules, EngineRollbackDescriptor } from './engine-ops'
import { hermesEnvironmentRules } from './hermes/hermes-env-rules'

const enginesDir = dirname(fileURLToPath(import.meta.url))

export function registeredEngineEnvironmentRules(): readonly EngineEnvironmentRules[] {
  return [hermesEnvironmentRules]
}

/** Self-contained rollback hook modules for registered engines, frozen alongside the deploy watchdog. */
export function registeredEngineRollbackHooks(): readonly EngineRollbackDescriptor[] {
  return [{ engineId: 'hermes', modulePath: join(enginesDir, 'hermes', 'hermes-rollback.ts') }]
}
