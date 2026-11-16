/** When each bot's current live state began. The server sends no start time, so this browser
 *  notes the moment it saw a state change. A state that was already running when the page
 *  loaded has no known start and shows no duration. Pure. */
import type { Bot } from '../../../shared/bot-schema'

const stateKey = (bot: Bot | undefined) => (bot?.activity && bot.activity.status !== 'idle' ? `${bot.activity.status}:${bot.activity.text}` : '')

export function activitySince(previous: Bot[], since: Record<string, number>, next: Bot[], now: number): Record<string, number> {
  const before = new Map(previous.map(bot => [bot.id, bot]))
  const result: Record<string, number> = {}
  for (const bot of next) {
    const key = stateKey(bot)
    if (!key) continue
    const old = before.get(bot.id)
    if (old && stateKey(old) === key) {
      if (since[bot.id] !== undefined) result[bot.id] = since[bot.id]
    } else if (old) {
      result[bot.id] = now
    }
  }
  return result
}

/** "just now", "4 min", "2 h". */
export function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h`
}
