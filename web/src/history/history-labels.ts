/** The dates and times the conversation history shows, in the device's time zone. Pure functions only. */

const DAY = 86_400_000

/** A calendar day in local time, for telling whether two messages were sent on the same day. */
export function dayKey(at: number) {
  const date = new Date(at)
  return date.getFullYear() * 10_000 + (date.getMonth() + 1) * 100 + date.getDate()
}

// The app is in English; fixed names keep every browser's output the same ("Sep", never "Sept,").
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The line between days: "Mon 9 Nov", with the year when it is not this year. */
export function dayLabel(at: number, now = Date.now()) {
  const date = new Date(at)
  const year = date.getFullYear() === new Date(now).getFullYear() ? '' : ` ${date.getFullYear()}`
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} ${MONTHS[date.getMonth()].slice(0, 3)}${year}`
}

const pad = (value: number) => String(value).padStart(2, '0')
const time = (at: number) => {
  const date = new Date(at)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** When a session began: "Today 14:20", "Yesterday 09:05", otherwise "Mon 9 Nov 14:20". */
export function sessionTime(at: number, now = Date.now()) {
  const day = dayKey(now) === dayKey(at) ? 'Today' : dayKey(now - DAY) === dayKey(at) ? 'Yesterday' : dayLabel(at, now)
  return `${day} ${time(at)}`
}

/** "3 September 2026", for the start of the conversation. */
export function startDate(at: number) {
  const date = new Date(at)
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`
}
