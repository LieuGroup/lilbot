/** Hermes has no profiles.delete RPC. Its CLI owns shutdown, profile files and identity settlement. */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { LilBotError } from '../../../shared/protocol'

export async function deleteRuntime(id: string) {
  // A previous attempt can remove the folder but fail to settle the gateway's routing identity.
  const exists = existsSync(join(process.env.HERMES_HOME ?? join(homedir(), '.hermes'), 'profiles', id))
  const child = Bun.spawn([process.env.LILBOT_HERMES_BIN ?? 'hermes', 'profile', exists ? 'delete' : 'purge-identity', id, ...(exists ? ['-y'] : [])], {
    env: process.env,
    stdout: 'ignore',
    stderr: 'ignore'
  })
  if ((await child.exited) !== 0) throw new LilBotError('delete_failed', 'The engine could not finish deleting this bot. Retry deletion.')
}
