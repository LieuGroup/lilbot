/** The memory adapter's own record of its saves before Hermes compresses (`lilbot-memory-saves.jsonl` in the profile,
 *  written by `memory-adapter/__init__.py`): session, time, whether it finished. A turn that failed while its session's
 *  latest save had failed stopped for want of the save (#148), also when it failed while LilBot was down. Read-only;
 *  the file holds ids and times, never conversation text. */
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_PROFILE } from './hermes-bot-mapping'
import { profileHome } from './hermes-memory-setup'

type Save = { session: string; at: number; saved: boolean }
const read = new Map<string, { stamp: string; saves: Save[] }>()

function saves(profile: string): Save[] {
  try {
    const path = join(profileHome(profile || DEFAULT_PROFILE), 'lilbot-memory-saves.jsonl')
    const { mtimeMs, size } = statSync(path)
    const stamp = `${mtimeMs}:${size}`
    const known = read.get(path)
    if (known?.stamp === stamp) return known.saves
    const parsed = readFileSync(path, 'utf8')
      .split('\n')
      .flatMap(line => {
        try {
          const save = JSON.parse(line)
          return typeof save?.session === 'string' && typeof save.at === 'number' && typeof save.saved === 'boolean'
            ? [{ session: save.session, at: save.at * 1000, saved: save.saved }]
            : []
        } catch {
          return []
        }
      })
    read.set(path, { stamp, saves: parsed })
    return parsed
  } catch {
    return []
  }
}

/** Whether, at `at` (milliseconds), the latest save before compressing of any of these session ids had failed. */
export function saveFailed(profile: string, sessions: string[], at = Date.now()): boolean {
  let latest: Save | undefined
  for (const save of saves(profile)) if (sessions.includes(save.session) && save.at <= at && (!latest || save.at >= latest.at)) latest = save
  return latest?.saved === false
}
