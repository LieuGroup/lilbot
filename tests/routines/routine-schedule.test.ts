import { expect, test } from 'bun:test'
import { nextRun, scheduleText } from '../../server/routines/routine-schedule'
import { RoutineSchedule } from '../../shared/routine-schema'

test('interval is strictly future and keeps phase across catch-up', () => {
  expect(nextRun({ kind: 'interval', seconds: 60 }, 301_000, 60_000)).toBe(360_000)
  expect(scheduleText({ kind: 'interval', seconds: 60 })).toBe('every minute')
})
test('Adelaide daily times use summer and winter offsets', () => {
  const schedule = { kind: 'daily', time: '08:00', timeZone: 'Australia/Adelaide' } as const
  expect(new Date(nextRun(schedule, Date.parse('2026-11-16T00:00Z'))).toISOString()).toBe('2026-11-16T21:30:00.000Z')
  expect(new Date(nextRun(schedule, Date.parse('2026-06-16T00:00Z'))).toISOString()).toBe('2026-06-16T22:30:00.000Z')
  expect(scheduleText(schedule)).toBe('every day at 08:00 (Australia/Adelaide)')
})
test('spring missing time is skipped; autumn repeated time runs once', () => {
  const schedule = { kind: 'daily', time: '02:30', timeZone: 'Australia/Adelaide' } as const
  expect(new Date(nextRun(schedule, Date.parse('2026-10-03T00:00Z'))).toISOString()).toBe('2026-10-04T16:00:00.000Z')
  const first = Date.parse('2026-04-04T16:00Z')
  expect(nextRun(schedule, first)).toBe(Date.parse('2026-04-05T17:00Z'))
})
test('weekly uses the local weekday and invalid zones are rejected', () => {
  const schedule = { kind: 'weekly', day: 1, time: '08:00', timeZone: 'Australia/Adelaide' } as const
  expect(new Date(nextRun(schedule, Date.parse('2026-11-15T00:00Z'))).toISOString()).toBe('2026-11-15T21:30:00.000Z')
  expect(RoutineSchedule.safeParse({ ...schedule, timeZone: 'Mars/Base' }).success).toBe(false)
})

test('weekly spring gap skips to the following week even when this week already passed', () => {
  const schedule = { kind: 'weekly', day: 0, time: '02:30', timeZone: 'Australia/Adelaide' } as const
  expect(new Date(nextRun(schedule, Date.parse('2026-09-27T00:00Z'))).toISOString()).toBe('2026-10-10T16:00:00.000Z')
})
