/** Fails verify when the web app's first load passes its budget (AGENTS.md: chat's first load stays about 220 kB JS and
 *  17 kB CSS, gzip -9). Same measurement as the growth report. Optional argument: another `dist/` to measure.
 *
 *  CSS is already over its 17 kB budget (18.8 kB on 2026-11-26, before #317), so its limit here is today's size rounded
 *  up, to stop it growing further: lowering it back to 17 kB needs the styles trimmed, or the budget changed, and that
 *  is the owner's decision, not this script's. */
import { firstLoad, kb } from './first-load'

const FIRST_LOAD_LIMITS = { js: 220_000, css: 19_000 }

const dist = process.argv[2]
const sizes = firstLoad(dist)
const over = (['js', 'css'] as const).filter(kind => sizes[kind] > FIRST_LOAD_LIMITS[kind])
for (const kind of ['js', 'css'] as const)
  console.log(`First load ${kind.toUpperCase()}: ${kb(sizes[kind])} of ${kb(FIRST_LOAD_LIMITS[kind])} (${kb(FIRST_LOAD_LIMITS[kind] - sizes[kind])} left)`)
if (over.length) {
  console.error(
    `The chat's first load is over its budget (${over.map(kind => kind.toUpperCase()).join(', ')}). Make the new code lazy (see the bundle budget in AGENTS.md) or keep zod and other heavy modules out of client imports.`
  )
  process.exit(1)
}
