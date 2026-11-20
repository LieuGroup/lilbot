import { expect, test } from 'bun:test'
import { compare, requireAgreed, targetOf, today } from '../../server/goals/goal-rules'
import type { GoalReview, GoalTarget } from '../../shared/goal-schema'

const NOW = Date.parse('2026-11-21T00:00:00Z')
const up: GoalTarget = {
  measure: 'downloads',
  source: 'store',
  baseline: { value: 100, at: NOW, evidence: { kind: 'link', url: 'https://example.com' } },
  value: 150,
  due: '2026-12-31'
}
const down: GoalTarget = { ...up, measure: 'churn', baseline: { ...up.baseline, value: 8 }, value: 2 }
const review = (value: number, moved: GoalReview['moved']): GoalReview => ({
  at: NOW,
  value,
  previous: 0,
  moved,
  met: false,
  stalled: false,
  did: '',
  work: { done: 0, open: 0, needsOscar: 0, failed: 0 },
  itemId: 'i'
})

test('a reading is compared with the previous review (or the baseline) and the target, in the direction of the target', () => {
  expect(compare(up, null, 120, NOW)).toEqual({ previous: 100, moved: 'toward', met: false, stalled: false })
  expect(compare(up, review(120, 'toward'), 110, NOW)).toMatchObject({ previous: 120, moved: 'away', met: false })
  expect(compare(up, null, 150, NOW)).toMatchObject({ moved: 'toward', met: true })
  expect(compare(down, null, 9, NOW)).toMatchObject({ previous: 8, moved: 'away', met: false })
  expect(compare(down, null, 2, NOW)).toMatchObject({ moved: 'toward', met: true })
})

test('stalled: nothing moved toward the target in this and the previous review, or the due date passed; never once met', () => {
  expect(compare(up, null, 100, NOW).stalled).toBe(false)
  expect(compare(up, review(100, 'toward'), 100, NOW).stalled).toBe(false)
  expect(compare(up, review(100, 'none'), 100, NOW).stalled).toBe(true)
  expect(compare(up, review(110, 'away'), 105, NOW).stalled).toBe(true)
  const late = Date.parse('2027-01-02T00:00:00Z')
  expect(compare(up, null, 140, late)).toMatchObject({ moved: 'toward', stalled: true })
  expect(compare(up, review(100, 'none'), 160, late)).toMatchObject({ met: true, stalled: false })
})

test('a target differs from its baseline, is due today or later in Adelaide, and its baseline points at one real reading', () => {
  const input = { measure: 'm', source: 's', baseline: 3, evidence: { proves: 'p', command: 'wc -l n', output: '3 n' }, value: 10, due: today(NOW) }
  expect(targetOf(input, () => null, NOW)).toMatchObject({ baseline: { value: 3, at: NOW, evidence: { kind: 'command', command: 'wc -l n', output: '3 n' } }, value: 10 })
  expect(() => targetOf({ ...input, value: 3 }, () => null, NOW)).toThrow(/differ from the baseline/)
  expect(() => targetOf({ ...input, due: '2026-11-19' }, () => null, NOW)).toThrow(/today or later/)
  expect(() => targetOf({ ...input, evidence: { proves: 'p', command: 'wc -l n' } }, () => null, NOW)).toThrow(/output/)
  expect(() => targetOf({ ...input, evidence: { proves: 'p', library: 'x' } }, () => null, NOW)).toThrow(/Library item/)
})

test('nothing is done for a goal of another bot, before Oscar agrees, while paused or after it ended', () => {
  const goal = { botId: 'a', state: 'agreed' } as Parameters<typeof requireAgreed>[0]
  expect(requireAgreed(goal, 'a')).toBe(goal!)
  expect(() => requireAgreed(goal, 'b')).toThrow(/No goal of yours/)
  expect(() => requireAgreed(null, 'a')).toThrow(/No goal of yours/)
  expect(() => requireAgreed({ ...goal!, state: 'proposed' }, 'a')).toThrow(/not agreed this goal yet/)
  expect(() => requireAgreed({ ...goal!, state: 'paused' }, 'a')).toThrow(/This goal is paused/)
})
