import { backgroundTask } from '../background'
import type { T3Grants } from './t3-grant'

/** A sign-in from `bun run t3:sign-in`, an expiry or a revocation changes which tools bots should see: tell the
 *  browsers, then give every bot its connections again. */
export function watchT3SignIn(grants: T3Grants, changed: () => void, refresh: () => Promise<void>, intervalMs = 5_000) {
  let generation = grants.generation()
  return setInterval(
    backgroundTask('connections watcher', async () => {
      const next = grants.generation()
      if (next === generation) return
      changed()
      await refresh()
      generation = next
    }),
    intervalMs
  )
}
