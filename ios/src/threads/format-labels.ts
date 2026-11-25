/** Local injectable date and byte formatters for `ios/src/threads/` while PR #299 moves the canonical helpers
 *  into `shared/client/`. Replace this module's defaults with `~shared/client/history/history-labels` and
 *  `~shared/client/attachments/attachment-rules` once PR #299 merges into `main`. */
import type { DateLabels } from '../../../shared/client/threads/thread-lines'

export interface ThreadFormatters extends DateLabels {
  clockTime: (at: number) => string
  formatBytes: (bytes: number) => string
}

const DAY = 86_400_000
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const pad = (value: number) => String(value).padStart(2, '0')

const fallbackDayKey = (at: number) => {
  const date = new Date(at)
  return date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()
}

const fallbackDayLabel = (at: number, now = Date.now()) => {
  const date = new Date(at)
  const year = date.getFullYear() === new Date(now).getFullYear() ? '' : ` ${date.getFullYear()}`
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}${year}`
}

const fallbackClockTime = (at: number) => {
  const date = new Date(at)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const fallbackSessionTime = (at: number, now = Date.now()) => {
  const day = fallbackDayKey(now) === fallbackDayKey(at) ? 'Today' : fallbackDayKey(now - DAY) === fallbackDayKey(at) ? 'Yesterday' : fallbackDayLabel(at, now)
  return `${day} ${fallbackClockTime(at)}`
}

const fallbackFormatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  const shown = value < 10 && unit > 0 ? Math.round(value * 10) / 10 : Math.round(value)
  return `${shown} ${units[unit]}`
}

const active: ThreadFormatters = {
  dayKey: fallbackDayKey,
  dayLabel: fallbackDayLabel,
  clockTime: fallbackClockTime,
  sessionTime: fallbackSessionTime,
  formatBytes: fallbackFormatBytes
}

/** Allows wiring canonical `shared/client/` formatters without duplicating logic across clients. */
export function configureThreadFormatters(overrides: Partial<ThreadFormatters>) {
  Object.assign(active, overrides)
}

export const clockTime = (at: number) => active.clockTime(at)
export const sessionTime = (at: number, now?: number) => active.sessionTime(at, now)
export const formatBytes = (bytes: number) => active.formatBytes(bytes)

export const THREAD_DATE_LABELS: DateLabels = {
  dayKey: at => active.dayKey(at),
  dayLabel: (at, now) => active.dayLabel(at, now),
  sessionTime: (at, now) => active.sessionTime(at, now)
}
