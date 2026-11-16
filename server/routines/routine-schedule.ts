import type { RoutineSchedule } from '../../shared/routine-schema'

const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function scheduleText(schedule: RoutineSchedule): string {
  if (schedule.kind !== 'interval') return `every ${schedule.kind === 'daily' ? 'day' : days[schedule.day]} at ${schedule.time} (${schedule.timeZone})`
  const seconds = schedule.seconds
  const [count, unit] =
    seconds % 86400 === 0 ? [seconds / 86400, 'day'] : seconds % 3600 === 0 ? [seconds / 3600, 'hour'] : seconds % 60 === 0 ? [seconds / 60, 'minute'] : [seconds, 'second']
  return `every ${count === 1 ? '' : `${count} `}${unit}${count === 1 ? '' : 's'}`
}

/** Strictly after `after`. Wall-clock schedules run once on a day; skip nonexistent DST times,
 * use the first occurrence of a repeated time. Intervals preserve their original phase. */
export function nextRun(schedule: RoutineSchedule, after: number, anchor = after): number {
  if (schedule.kind === 'interval') return anchor + (Math.floor((after - anchor) / (schedule.seconds * 1000)) + 1) * schedule.seconds * 1000
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone: schedule.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
  const parts = (value: number) => Object.fromEntries(format.formatToParts(value).map(part => [part.type, part.value]))
  const local = parts(after)
  const date = Date.UTC(Number(local.year), Number(local.month) - 1, Number(local.day))
  const [hour, minute] = schedule.time.split(':').map(Number)
  for (let day = 0; day < 16; day++) {
    const target = date + day * 86400000 + hour * 3600000 + minute * 60000
    if (schedule.kind === 'weekly' && new Date(target).getUTCDay() !== schedule.day) continue
    const offsets = new Set(
      [-86400000, 0, 86400000].map(delta => {
        const probe = target + delta
        const p = parts(probe)
        return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) - probe
      })
    )
    const candidates = [...offsets]
      .map(offset => target - offset)
      .filter(value => {
        const p = parts(value)
        return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute)) === target
      })
      .sort((a, b) => a - b)
    if (candidates.length && candidates[0] > after) return candidates[0]
  }
  throw new Error('Could not resolve the next routine time.')
}
