/** Pure device-zone date/time and byte-size formatters for Bot Details screens (Routines, Webhooks,
 *  Library, Skills). Kept self-contained under `ios/src/ui/` to stay disjoint from PR #299. */
const DAY = 86_400_000
const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dayKey(at: number): string {
  const d = new Date(at)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

export function clockTime(at: number): string {
  const d = new Date(at)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  return `${h}:${m}`
}

export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at)
  const n = new Date(now)
  if (dayKey(at) === dayKey(now)) return 'Today'
  if (dayKey(at) === dayKey(now - DAY)) return 'Yesterday'
  const base = `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`
  return d.getFullYear() === n.getFullYear() ? base : `${base} ${d.getFullYear()}`
}

export function sessionTime(at: number, now = Date.now()): string {
  return `${dayLabel(at, now)} ${clockTime(at)}`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`
}
