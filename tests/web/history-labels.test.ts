import { expect, test } from 'bun:test'
import { dayKey, dayLabel, sessionTime, startDate } from '../../web/src/history/history-labels'

const at = (year: number, month: number, day: number, hour = 12, minute = 0) => new Date(year, month - 1, day, hour, minute).getTime()
const now = at(2026, 11, 19, 15, 0)

test('day lines name the weekday, day and month, with the year only for another year', () => {
  expect(dayLabel(at(2026, 11, 9), now)).toBe('Mon 9 Nov')
  expect(dayLabel(at(2025, 9, 3), now)).toBe('Wed 3 Sep 2025')
})

test('two times on the same local day share a day', () => {
  expect(dayKey(at(2026, 11, 9, 0, 1))).toBe(dayKey(at(2026, 11, 9, 23, 59)))
  expect(dayKey(at(2026, 11, 9, 23, 59))).not.toBe(dayKey(at(2026, 11, 10, 0, 0)))
})

test('a session divider says today, yesterday or the date, with the time', () => {
  expect(sessionTime(at(2026, 11, 19, 14, 20), now)).toBe('Today 14:20')
  expect(sessionTime(at(2026, 11, 18, 9, 5), now)).toBe('Yesterday 09:05')
  expect(sessionTime(at(2026, 11, 10, 8, 0), now)).toBe('Tue 10 Nov 08:00')
})

test('the start of the conversation is a full date', () => {
  expect(startDate(at(2026, 9, 3))).toBe('3 September 2026')
})
