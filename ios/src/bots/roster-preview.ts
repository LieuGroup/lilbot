/** Pure iPhone roster last-message preview and locale-aware timestamp formatting.
 *  Zero React Native runtime imports so unit tests verify every rule and locale on Linux. */
import type { Bot, BotLastMessage } from '../../../shared/bot-schema'
import type { RowTone } from '../../../shared/client/bots/row-state'

export interface RosterTimeOptions {
  now?: number
  locale?: string
  timeZone?: string
}

export const USER_MESSAGE_PREFIX = 'You: '

const MS_PER_DAY = 86_400_000

/** Formats the second-line preview from `bot.lastMessage`, prefixing the owner's own messages with "You: ". */
export function formatLastMessagePreview(lastMessage: BotLastMessage | undefined): string | null {
  if (!lastMessage) return null
  const trimmed = lastMessage.text.trim()
  if (!trimmed) return null
  return lastMessage.from === 'user' ? `${USER_MESSAGE_PREFIX}${trimmed}` : trimmed
}

/** True when live operational status must win over `lastMessage` on the roster row's second line. */
export function hasActiveLiveRowState(bot: Bot, tone: RowTone): boolean {
  if (tone !== 'idle') return true
  if (!bot.runnable && !bot.runtimePending) return true
  return Boolean(bot.groups && bot.groups.length > 0)
}

function calendarParts(ms: number, timeZone?: string): { year: number; month: number; day: number } {
  if (!timeZone) {
    const d = new Date(ms)
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }
  }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date(ms))
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0)
  return { year: get('year'), month: get('month'), day: get('day') }
}

/** Formats a message timestamp in the device's locale:
 *  - today -> short time (e.g. "2:15 pm" / "14:15")
 *  - 1..6 calendar days ago -> short weekday (e.g. "Tue")
 *  - 7+ calendar days ago in the same year -> short month & day (e.g. "15 Nov" / "Nov 15")
 *  - earlier year -> short locale date (e.g. "20/12/25") */
export function formatRosterTime(at: number, options: RosterTimeOptions = {}): string | null {
  if (!Number.isFinite(at) || at <= 0) return null
  const now = options.now ?? Date.now()
  if (!Number.isFinite(now)) return null

  const atParts = calendarParts(at, options.timeZone)
  const nowParts = calendarParts(now, options.timeZone)
  const dayDiff = Math.round((Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day) - Date.UTC(atParts.year, atParts.month - 1, atParts.day)) / MS_PER_DAY)
  const date = new Date(at)
  const tz = options.timeZone ? { timeZone: options.timeZone } : {}

  if (dayDiff === 0 || (dayDiff < 0 && at - now < MS_PER_DAY)) {
    return new Intl.DateTimeFormat(options.locale, { ...tz, timeStyle: 'short' }).format(date)
  }
  if (dayDiff >= 1 && dayDiff <= 6) {
    return new Intl.DateTimeFormat(options.locale, { ...tz, weekday: 'short' }).format(date)
  }
  if (atParts.year === nowParts.year) {
    return new Intl.DateTimeFormat(options.locale, { ...tz, month: 'short', day: 'numeric' }).format(date)
  }
  return new Intl.DateTimeFormat(options.locale, { ...tz, dateStyle: 'short' }).format(date)
}

/** Milliseconds until the next local calendar midnight (+1 s buffer) so relative labels roll over cleanly. */
export function msUntilNextLocalDay(now = Date.now()): number {
  const d = new Date(now)
  const nextMidnight = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 1, 0).getTime()
  return Math.max(1000, nextMidnight - now)
}

/** Local calendar day key (`YYYY-M-D`) used to refresh timestamps only when the calendar day changes. */
export function localDayKey(ms = Date.now()): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}
