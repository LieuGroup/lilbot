/** The words the Routines screens show (Paper "07 Routines"): a schedule, a row's state line, a run's line and its time.
 *  Pure functions only; times are in the device's zone. */
import type { Routine, RoutineRun, RoutineSchedule } from '../../../shared/routine-schema'
import { clockTime, dayKey, dayLabel, sessionTime } from '../history/history-labels'

const DAY = 86_400_000
const WEEKDAYS = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays']

function every(seconds: number) {
  const units: [number, string, string][] = [
    [86_400, 'day', 'days'],
    [3600, 'hour', 'hours'],
    [60, 'minute', 'min'],
    [1, 'second', 's']
  ]
  const [size, one, many] = units.find(([size]) => seconds % size === 0) ?? units[3]
  const count = seconds / size
  return count === 1 ? `Every ${one}` : `Every ${count} ${many}`
}

/** "Every day at 09:00", "Mondays at 08:00", "Every 30 min"; a calendar schedule in another zone than the device's says
 *  which ("Every day at 09:00 Adelaide time"). */
export function scheduleLabel(schedule: RoutineSchedule, deviceZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  if (schedule.kind === 'interval') return every(schedule.seconds)
  const zone = schedule.timeZone === deviceZone ? '' : ` ${schedule.timeZone.split('/').pop()?.replaceAll('_', ' ')} time`
  return `${schedule.kind === 'daily' ? 'Every day' : WEEKDAYS[schedule.day]} at ${schedule.time}${zone}`
}

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

/** "Today 18:00", "Tomorrow 09:00", "Mon 23 Nov 09:00"; without the time when the schedule already says it. */
export function whenNext(at: number, now = Date.now(), time = true) {
  const day = dayKey(at) === dayKey(now) ? 'Today' : dayKey(at) === dayKey(now + DAY) ? 'Tomorrow' : dayLabel(at, now)
  return time ? `${day} ${clockTime(at)}` : day
}

type RoutineTone = 'running' | 'failed' | 'paused' | 'plain'

/** A routine's second line in the list: running now, else paused, else a failed last run, else its schedule and next run. */
export function routineLine(routine: Routine, now = Date.now()): { text: string; tone: RoutineTone } {
  const schedule = scheduleLabel(routine.schedule)
  const latest = routine.runs[0]
  if (latest && (latest.status === 'running' || latest.status === 'pending')) return { text: `Running now · ${lowerFirst(schedule)}`, tone: 'running' }
  if (routine.paused) return { text: `Paused · ${schedule}`, tone: 'paused' }
  if (latest?.status === 'failed') return { text: `Last run failed · next ${lowerFirst(whenNext(routine.nextRunAt, now))}`, tone: 'failed' }
  return { text: `${schedule} · next ${lowerFirst(whenNext(routine.nextRunAt, now, routine.schedule.kind === 'interval'))}`, tone: 'plain' }
}

/** Under a routine or webhook run's title: its result, or what it is doing; a failed run says so first. */
export function runLine(run: Pick<RoutineRun, 'status' | 'result'>) {
  const result = run.result.replace(/\s+/g, ' ').trim()
  switch (run.status) {
    case 'pending':
      return 'Starting...'
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

/** "48 s", "3 min", "1 h 5 min". */
export function duration(ms: number) {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return minutes % 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes / 60} h`
}

/** The opened run's header: when it started and how long it took ("Today 09:00 · 48 s"), or that it is still running. */
export function runHeader(run: RoutineRun, now = Date.now()) {
  const started = run.startedAt ?? run.dueAt
  const length = run.finishedAt ? duration(run.finishedAt - started) : 'running'
  return `${sessionTime(started, now)} · ${length}`
}

/** Who made it: a goal's review routine, Oscar's request or the bot's own idea. */
export const createdText = (routine: Routine, goal: string | undefined) => (goal ? 'For your goal' : routine.createdBy === 'oscar' ? 'You asked for it' : 'The bot set it up')
