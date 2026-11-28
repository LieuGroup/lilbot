/** The deploy rollback step for `check:prompt`, run against the real dev Hermes on one temporary profile. */
import { command } from '../server/deploy/process'
import { rollbackHook } from '../server/engines/hermes/hermes-rollback'

/** Runs the real deploy rollback hook on one temporary `dev-` profile against the dev Hermes, then asks Hermes itself
 *  how it lists the prompt plug-in (`enabled`, `disabled`, `not enabled`, or absent). */
export async function rollBackPromptPlugin(profileId: string) {
  if (!profileId.startsWith('dev-')) throw new Error(`Refusing to touch non-dev profile: ${profileId}`)
  const env = Object.entries({ LILBOT_ENV: 'development', HERMES_HOME: process.env.HERMES_HOME, LILBOT_HERMES_BIN: process.env.LILBOT_HERMES_BIN, PATH: process.env.PATH })
  const printed = env
    .filter(([, value]) => value)
    .map(([key, value]) => `"${key}=${value}"`)
    .join(' ')
  const rolled = await rollbackHook.rollback({ profiles: [profileId], printedEnvironment: printed, runCommand: (args, timeout, given) => command(args, undefined, timeout, given) })
  const listed = Bun.spawnSync([process.env.LILBOT_HERMES_BIN ?? 'hermes', '-p', profileId, 'plugins', 'list', '--plain', '--no-bundled'], { env: process.env }).stdout.toString()
  return { rolled, row: listed.split('\n').find(line => line.includes('lilbot-prompt-v1')) ?? 'absent' }
}
