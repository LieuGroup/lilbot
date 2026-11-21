import { expect, test } from 'bun:test'
import type { Routine, RoutineRun } from '../../shared/routine-schema'
import { createdText, duration, routineLine, runHeader, runLine, scheduleLabel, whenNext } from '../../web/src/routines/routine-lines'

const NOW = new Date(2026, 10, 21, 10, 0).getTime()
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime()
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone

const run = (extra: Partial<RoutineRun> = {}): RoutineRun => ({
  id: 'r1',
  routineId: 'x',
  botId: 'b',
  dueAt: at(21, 9),
  startedAt: at(21, 9),
  finishedAt: at(21, 9, 1),
  chatId: 'c',
  status: 'completed',
  result: '',
  ...extra
})

const routine = (extra: Partial<Routine> = {}): Routine => ({
  id: 'x',
  botId: 'b',
  description: 'Check new App Store reviews',
  schedule: { kind: 'daily', time: '09:00', timeZone: zone },
  scheduleText: '',
  createdBy: 'oscar',
  paused: false,
  lastRunAt: null,
  nextRunAt: at(22, 9),
  runs: [],
  ...extra
})

test('schedules read as the design writes them, with the zone only when it is not the device’s', () => {
  expect(scheduleLabel({ kind: 'daily', time: '09:00', timeZone: zone })).toBe('Every day at 09:00')
  expect(scheduleLabel({ kind: 'weekly', day: 1, time: '08:00', timeZone: zone })).toBe('Mondays at 08:00')
  expect(scheduleLabel({ kind: 'daily', time: '09:00', timeZone: 'America/New_York' }, 'Australia/Adelaide')).toBe('Every day at 09:00 New York time')
  expect(scheduleLabel({ kind: 'interval', seconds: 1800 })).toBe('Every 30 min')
  expect(scheduleLabel({ kind: 'interval', seconds: 3600 })).toBe('Every hour')
  expect(scheduleLabel({ kind: 'interval', seconds: 7200 })).toBe('Every 2 hours')
  expect(scheduleLabel({ kind: 'interval', seconds: 60 })).toBe('Every minute')
  expect(scheduleLabel({ kind: 'interval', seconds: 90 })).toBe('Every 90 s')
})

test('the next run is today, tomorrow or a date', () => {
  expect(whenNext(at(21, 18), NOW)).toBe('Today 18:00')
  expect(whenNext(at(22, 9), NOW, false)).toBe('Tomorrow')
  expect(whenNext(at(24, 9), NOW)).toBe('Tue 24 Nov 09:00')
})

test('a row’s line: running first, then paused, then a failed last run, else schedule and next run', () => {
  expect(routineLine(routine(), NOW)).toEqual({ text: 'Every day at 09:00 · next tomorrow', tone: 'plain' })
  expect(routineLine(routine({ schedule: { kind: 'interval', seconds: 1800 }, nextRunAt: at(21, 10, 30) }), NOW).text).toBe('Every 30 min · next today 10:30')
  expect(routineLine(routine({ runs: [run({ status: 'running', finishedAt: null })], schedule: { kind: 'interval', seconds: 1800 } }), NOW)).toEqual({
    text: 'Running now · every 30 min',
    tone: 'running'
  })
  expect(routineLine(routine({ paused: true, schedule: { kind: 'weekly', day: 1, time: '08:00', timeZone: zone } }), NOW)).toEqual({
    text: 'Paused · Mondays at 08:00',
    tone: 'paused'
  })
  expect(routineLine(routine({ runs: [run({ status: 'failed' })], nextRunAt: at(21, 18) }), NOW)).toEqual({ text: 'Last run failed · next today 18:00', tone: 'failed' })
})

test('a run’s line, its length and the opened run’s header', () => {
  expect(runLine(run({ result: '2 new reviews,\n\nboth 5 stars.' }))).toBe('2 new reviews, both 5 stars.')
  expect(runLine(run({ status: 'failed', result: 'App Store Connect did not answer.' }))).toBe('Failed: App Store Connect did not answer.')
  expect(runLine(run({ status: 'failed' }))).toBe('Failed.')
  expect(runLine(run({ status: 'stopped' }))).toBe('Stopped.')
  expect(runLine(run({ status: 'pending', chatId: null }))).toBe('Starting...')
  expect([duration(48_000), duration(180_000), duration(3_900_000), duration(7_200_000)]).toEqual(['48 s', '3 min', '1 h 5 min', '2 h'])
  expect(runHeader(run({ finishedAt: at(21, 9) + 48_000 }), NOW)).toBe('Today 09:00 · 48 s')
  expect(runHeader(run({ finishedAt: null, status: 'running' }), NOW)).toBe('Today 09:00 · running')
})

test('who made it: a goal’s review, Oscar or the bot', () => {
  expect(createdText(routine(), 'Grow notes.txt to 10 lines')).toBe('For your goal')
  expect(createdText(routine(), undefined)).toBe('You asked for it')
  expect(createdText(routine({ createdBy: 'bot' }), undefined)).toBe('The bot set it up')
})
