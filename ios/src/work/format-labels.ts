/** Local injectable date/clock formatters for `ios/src/work/` while PR #299 moves `history-labels.ts` into `shared/client/`.
 *  Switch to `~shared/client/history/history-labels` once PR #299 merges into `main`. */
import type { WorkDateLabels } from '../../../shared/client/work/work-lines'

export interface WorkFormatters extends WorkDateLabels {
  clockTime: (at: number) => string
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

const active: WorkFormatters = {
  dayKey: fallbackDayKey,
  dayLabel: fallbackDayLabel,
  clockTime: fallbackClockTime,
  sessionTime: fallbackSessionTime
}

/** Allows wiring canonical `shared/client/history/history-labels` once PR #299 merges. */
export function configureWorkFormatters(overrides: Partial<WorkFormatters>) {
  Object.assign(active, overrides)
}

export const clockTime = (at: number) => active.clockTime(at)

export const WORK_DATE_LABELS: WorkDateLabels = {
  dayKey: at => active.dayKey(at),
  dayLabel: (at, now) => active.dayLabel(at, now),
  sessionTime: (at, now) => active.sessionTime(at, now)
}
