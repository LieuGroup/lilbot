/** The single registration point for concrete server bot engines.
 *  Runtime engine modules load by path inside `createDefaultEngines` so Node-loaded callers
 *  (such as `vite.config.ts` -> `server/environment.ts`) never pull Bun-only engine runtimes into Vite. */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { EngineEnvironmentRules, EngineRollbackDescriptor } from './engine-ops'
import { EngineRegistry } from './engine-registry'
import type { HermesEngine } from './hermes/hermes-engine'
import { hermesEnvironmentRules } from './hermes/hermes-env-rules'

const enginesDir = dirname(fileURLToPath(import.meta.url))

export async function createDefaultEngines(env: Record<string, string | undefined> = process.env): Promise<EngineRegistry> {
  const mod = (await import(join(enginesDir, 'hermes', 'hermes-engine.ts'))) as { HermesEngine: typeof HermesEngine }
  const botIds = env.LILBOT_BOT_IDS?.split(',').filter(Boolean)
  return new EngineRegistry([new mod.HermesEngine(botIds)])
}

export function registeredEngineEnvironmentRules(): readonly EngineEnvironmentRules[] {
  return [hermesEnvironmentRules]
}

/** Self-contained rollback hook modules for registered engines, frozen alongside the deploy watchdog. */
export function registeredEngineRollbackHooks(): readonly EngineRollbackDescriptor[] {
  return [{ engineId: 'hermes', modulePath: join(enginesDir, 'hermes', 'hermes-rollback.ts') }]
}
