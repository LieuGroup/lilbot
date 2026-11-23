/** Runtime registration point for concrete server bot engines (startup only).
 *  Pure metadata (environment rules, deploy rollback descriptors) lives in `metadata.ts`. */
import { EngineRegistry } from './engine-registry'
import { HermesEngine } from './hermes/hermes-engine'

export function createDefaultEngines(env: Record<string, string | undefined> = process.env): EngineRegistry {
  const botIds = env.LILBOT_BOT_IDS?.split(',').filter(Boolean)
  return new EngineRegistry([new HermesEngine(botIds)])
}
