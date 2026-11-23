/** The single registration point for concrete server bot engines. */
import { join } from 'node:path'
import type { EngineEnvironmentRules, EngineRollbackDescriptor } from './engine-ops'
import { EngineRegistry } from './engine-registry'
import { HermesEngine } from './hermes/hermes-engine'
import { hermesEnvironmentRules } from './hermes/hermes-env-rules'

export function createDefaultEngines(env: Record<string, string | undefined> = process.env): EngineRegistry {
  const botIds = env.LILBOT_BOT_IDS?.split(',').filter(Boolean)
  return new EngineRegistry([new HermesEngine(botIds)])
}

export function registeredEngineEnvironmentRules(): readonly EngineEnvironmentRules[] {
  return [hermesEnvironmentRules]
}

/** Self-contained rollback hook modules for registered engines, frozen alongside the deploy watchdog. */
export function registeredEngineRollbackHooks(): readonly EngineRollbackDescriptor[] {
  return [{ engineId: 'hermes', modulePath: join(import.meta.dir, 'hermes', 'hermes-rollback.ts') }]
}
