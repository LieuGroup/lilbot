/** Self-contained deploy-rollback hook for Hermes, frozen alongside the deploy watchdog.
 *  Must keep zero runtime imports outside `node:*` so it runs from `<data>/deploy/runner/engine-hooks/`
 *  even when the failed release cannot start.
 *
 *  A rollback to a release from before #148 would leave every connected Hermes bot fail-closed
 *  (`compression.checkpoint_required`) with a memory adapter that cannot take the save, so it could never
 *  shorten a long conversation again. Before the previous release starts, the watchdog clears the flag
 *  for every bound, non-deleted Hermes bot whose profile has it; a release that has #148 sets it again
 *  once at start-up (`hermes-memory-setup.ts`). Hermes runs with the service's own Hermes home and
 *  executable, never the watchdog's, and in development only on `dev-` profiles under the development home. */
import type { EngineRollbackContext, EngineRollbackHook, EngineRollbackResult } from '../engine-ops'

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
export function rollbackProfiles(profiles: readonly string[], env: Record<string, string>): string[][] {
  const development = env.LILBOT_ENV === 'development'
  if (development && !/\/lilbot-dev\/hermes\/?$/.test(env.HERMES_HOME ?? '')) return []
  return [...new Set(profiles)].filter(id => PROFILE_ID.test(id) && id.startsWith('dev-') === development).map(id => (id === 'default' ? [] : ['-p', id]))
}

export const rollbackHook: EngineRollbackHook = {
  engineId: 'hermes',
  async rollback(context: EngineRollbackContext): Promise<EngineRollbackResult> {
    if (context.printedEnvironment === null) return { cleared: 0, failed: context.profiles.length || 1 }
    const env = serviceEnvironment(context.printedEnvironment)
    const hermes = env.LILBOT_HERMES_BIN || 'hermes'
    // The watchdog's own Hermes settings never leak in: without the service's, Hermes uses its defaults as the service does.
    const base = Object.fromEntries(Object.entries(process.env).filter(([key]) => !(PASSED as readonly string[]).includes(key) || key === 'PATH'))
    const run = (args: string[]) => context.runCommand([hermes, ...args], 30_000, { ...base, ...env })
    const result = { cleared: 0, failed: 0 }
    for (const profile of rollbackProfiles(context.profiles, env)) {
      let touched = false
      try {
        for (const key of ['compression.checkpoint_required', 'plugins.entries.lilbot-prompt-v1.enabled']) {
          // The value is the last line: anything Hermes prints before it is not the setting.
          if ((await run([...profile, 'config', 'get', key])).trim().split('\n').at(-1)?.trim().toLowerCase() !== 'true') continue
          await run([...profile, 'config', 'set', key, 'false'])
          touched = true
        }
        if (touched) result.cleared++
      } catch {
        result.failed++
      }
    }
    return result
  }
}
