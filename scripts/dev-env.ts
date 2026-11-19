/** Imported first by every live check, before any engine module reads the environment. */
import { join } from 'node:path'
import { cleanDevScratch, devPort, devScratch } from './dev-paths'

export { devScratch } from './dev-paths'

import { assertDevelopmentTarget, assertServerEnvironment, canonicalPath, developmentHome } from '../server/environment'

assertDevelopmentTarget(process.env)
if (canonicalPath(developmentHome) !== developmentHome) throw new Error('Development refuses a symlinked home')
// Reject questionable overrides instead of silently replacing a production target.
for (const key of ['HERMES_HOME', 'HERMES_GATEWAY_LOCK_DIR']) {
  const expected = join(developmentHome, key === 'HERMES_HOME' ? 'hermes' : 'hermes-locks')
  if (process.env[key] && process.env[key] !== expected) throw new Error(`${key} must be ${expected} for live checks`)
  process.env[key] = expected
}
process.env.LILBOT_ENV = 'development'
process.env.LILBOT_HOST = '127.0.0.1'
process.env.LILBOT_PUBLIC_ENABLED = '0'
process.env.LILBOT_ACCESS_ENABLED = '0'

// Each check uses one root; all extra fixtures also go under runs/.
const root = devScratch('check')
process.env.LILBOT_DATA_DIR = root
process.env.LILBOT_WORKSPACES_DIR = join(root, 'workspaces')
process.env.LILBOT_SKILLS_DIR = join(root, 'skills')
process.env.LILBOT_PORT = process.env.LILBOT_CHECK_PORT ?? String(devPort())
process.env.LILBOT_CHECK_PORT = process.env.LILBOT_PORT
assertServerEnvironment(process.env)
// Synchronous teardown also runs for checks that explicitly call process.exit().
process.on('exit', cleanDevScratch)
