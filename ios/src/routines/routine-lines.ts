/** Pure Routine display labels mirroring `web/src/routines/routine-lines.ts`. */
import type { Routine, RoutineRun, RoutineSchedule } from '../../../shared/routine-schema'
import { clockTime, dayKey, dayLabel, sessionTime } from '../ui/format-time'

const DAY = 86_400_000
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

function every(seconds: number): string {
  const units: [number, string, string][] = [
    [86_400, 'day', 'days'],
    [3600, 'hour', 'hours'],
    [60, 'minute', 'min'],
    [1, 'second', 's']
  ]
  const [size, one, many] = units.find(([unitSize]) => seconds % unitSize === 0) ?? units[3]
  const count = seconds / size
  return count === 1 ? `Every ${one}` : `Every ${count} ${many}`
}

export function scheduleLabel(schedule: RoutineSchedule, deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone): string {
  if (schedule.kind === 'interval') return every(schedule.seconds)
  const zone = schedule.timeZone === deviceZone ? '' : ` ${schedule.timeZone.split('/').pop()?.replaceAll('_', ' ')} time`
  return `${schedule.kind === 'daily' ? 'Every day' : WEEKDAYS[schedule.day]} at ${schedule.time}${zone}`
}

export function whenNext(at: number, now = Date.now()): string {
  if (dayKey(at) === dayKey(now)) return `Today at ${clockTime(at)}`
  if (dayKey(at) === dayKey(now + DAY)) return `Tomorrow at ${clockTime(at)}`
  return `${dayLabel(at, now)} at ${clockTime(at)}`
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

export type RoutineTone = 'running' | 'paused' | 'failed' | 'plain'

export function routineLine(routine: Routine, now = Date.now()): { text: string; tone: RoutineTone } {
  const latest = routine.runs[0]
  if (latest && (latest.status === 'running' || latest.status === 'pending')) {
    return { text: `Running now · ${scheduleLabel(routine.schedule)}`, tone: 'running' }
  }
  if (routine.paused) return { text: `Paused · ${scheduleLabel(routine.schedule)}`, tone: 'paused' }
  const next = `next ${lowerFirst(whenNext(routine.nextRunAt, now))}`
  if (latest?.status === 'failed') return { text: `Last run failed · ${next}`, tone: 'failed' }
  return { text: `${scheduleLabel(routine.schedule)} · ${next}`, tone: 'plain' }
}

export function runLine(run: Pick<RoutineRun, 'status' | 'result'>): string {
  const result = run.result.replace(/\s+/g, ' ').trim()
  switch (run.status) {
    case 'pending':
      return 'Starting…'
    case 'running':
      return 'Running now'
    case 'completed':
      return result || 'Finished.'
    case 'failed':
      return result ? `Failed: ${result}` : 'Failed.'
    case 'stopped':
      return 'Stopped.'
  }
}

export function duration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`
}

export function runHeader(run: RoutineRun, now = Date.now()): string {
  const started = run.startedAt ?? run.dueAt
  const length = run.finishedAt ? duration(run.finishedAt - started) : 'running'
  return `${sessionTime(started, now)} · ${length}`
}

export const createdRoutineText = (routine: Routine, goal: string | undefined) =>
  goal ? 'For your goal' : routine.createdBy === 'oscar' ? 'You asked for it' : 'The bot set it up'
