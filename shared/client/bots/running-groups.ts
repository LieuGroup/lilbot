/** Active temporary groups shown in the roster's "Working together" section, gathered from `bots.list`. */
import type { Bot } from '../../bot-schema'

export interface RunningGroup {
  id: string
  purpose: string
  round: number
  /** The leader first, then the members in roster order. */
  bots: Bot[]
}

/** Every running group in `bots.list`, with its bots gathered from each bot's `groups`. */
export function runningGroups(bots: Bot[]): RunningGroup[] {
  const byId = new Map<string, RunningGroup>()
  for (const bot of bots) {
    for (const group of bot.groups ?? []) {
      const entry = byId.get(group.id) ?? { id: group.id, purpose: group.purpose, round: group.round, bots: [] }
      if (group.leading) entry.bots.unshift(bot)
      else entry.bots.push(bot)
      byId.set(group.id, entry)
    }
  }
  return [...byId.values()]
}
