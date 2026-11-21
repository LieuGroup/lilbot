/** A rollback to a release from before #148 would leave every connected Hermes bot fail-closed
 *  (`compression.checkpoint_required`) with a memory adapter that cannot take the save, so it could never shorten a long
 *  conversation again. Before the previous release starts, the watchdog clears the flag for every bound, non-deleted bot
 *  whose profile has it; a release that has #148 sets it again once at start-up (`engines/hermes/hermes-memory-setup.ts`).
 *  Frozen with the watchdog, so self-contained. Hermes runs with the service's own Hermes home and executable, never the
 *  watchdog's, and in development only on `dev-` profiles under the development home. */
import { DatabaseSync } from 'node:sqlite'
import { command } from './process'

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/
const PASSED = ['HERMES_HOME', 'LILBOT_HERMES_BIN', 'LILBOT_ENV', 'PATH'] as const

/** The unit's `Environment` as systemd prints it (`KEY=value`, double-quoted when it holds spaces), only the keys Hermes needs. */
export function serviceEnvironment(printed: string): Record<string, string> {
  const pairs = [...printed.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map(match => (match[1] ?? match[2]).replace(/\\(.)/g, '$1'))
  const env: Record<string, string> = {}
  for (const pair of pairs) {
    const at = pair.indexOf('=')
    const key = pair.slice(0, at)
    if (at > 0 && (PASSED as readonly string[]).includes(key)) env[key] = pair.slice(at + 1)
  }
  return env
}

/** The `hermes` argument lists that read the flag, one per profile this service may touch (none when unsafe to tell). */
export function rollbackProfiles(profiles: string[], env: Record<string, string>): string[][] {
  const development = env.LILBOT_ENV === 'development'
  if (development && !/\/lilbot-dev\/hermes\/?$/.test(env.HERMES_HOME ?? '')) return []
  return [...new Set(profiles)].filter(id => PROFILE_ID.test(id) && id.startsWith('dev-') === development).map(id => (id === 'default' ? [] : ['-p', id]))
}

/** Clears the flag where it is set, from the restored database and the service unit's printed `Environment` (null when
 *  systemd could not say). Never throws: a profile that cannot be read or changed is counted, not fatal. */
export async function clearCheckpointFlags(database: string, printed: string | null): Promise<{ cleared: number; failed: number }> {
  const result = { cleared: 0, failed: 0 }
  let profiles: string[] = []
  try {
    const db = new DatabaseSync(database, { readOnly: true })
    try {
      profiles = (db.prepare("SELECT engine_bot_id FROM bots WHERE engine_id = 'hermes' AND deletion IS NULL").all() as { engine_bot_id: string }[]).map(row => row.engine_bot_id)
    } finally {
      db.close()
    }
  } catch {
    return { cleared: 0, failed: 1 }
  }
  if (printed === null) return { cleared: 0, failed: profiles.length || 1 }
  const env = serviceEnvironment(printed)
  const hermes = env.LILBOT_HERMES_BIN || 'hermes'
  // The watchdog's own Hermes settings never leak in: without the service's, Hermes uses its defaults as the service does.
  const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !(PASSED as readonly string[]).includes(key) || key === 'PATH'))
  const run = (args: string[]) => command([hermes, ...args], undefined, 30_000, { ...base, ...env })
  for (const profile of rollbackProfiles(profiles, env)) {
    try {
      if ((await run([...profile, 'config', 'get', 'compression.checkpoint_required'])).trim().toLowerCase() !== 'true') continue
      await run([...profile, 'config', 'set', 'compression.checkpoint_required', 'false'])
      result.cleared++
    } catch {
      result.failed++
    }
  }
  return result
}
