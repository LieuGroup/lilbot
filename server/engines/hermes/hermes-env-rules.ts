/** Declarative development-environment safety rules owned by the Hermes engine. */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EngineEnvironmentRules } from '../engine-ops'

export const hermesEnvironmentRules: EngineEnvironmentRules = {
  engineId: 'hermes',
  protectedDevPaths: () => ({ HERMES_HOME: join(homedir(), '.hermes') }),
  requiredDevPathVars: ['HERMES_HOME', 'HERMES_GATEWAY_LOCK_DIR']
}
