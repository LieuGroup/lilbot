/** Today's date and time for the per-turn message. While LilBot owns the system prompt, the engine's own
 *  "conversation started" date line is gone, and the cached prompt must not change from day to day, so the
 *  date travels with each turn instead, beside the `[LilBot origin]` line. */
export function dateLine(now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  const when = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'longOffset'
  }).format(now)
  return `[LilBot date: ${when} (${timeZone})]`
}
