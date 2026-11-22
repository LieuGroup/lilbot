import { describe, expect, test } from 'bun:test'
import type { Goal, GoalDetail, GoalReview } from '../../shared/goal-schema'
import type { WorkSummary } from '../../shared/work-schema'
import {
  canResumeGoal,
  daysLeftLabel,
  goalCardMode,
  goalDeltaText,
  goalProgress,
  goalWorkStats,
  nextReviewLine,
  numberStatusText,
  orderedReviews,
  readingProvenance,
  reviewNumberDetail,
  sortGoals
} from '../../web/src/goals/goal-lines'

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: 'g1',
    botId: 'b1',
    botName: 'FillLight Bot',
    text: "Grow FillLight's downloads",
    state: 'agreed',
    agreement: { alone: ['Rewrite copy'], needsOscar: ['Ad budget'], cannotInfluence: ['Season'] },
    target: {
      measure: 'downloads a week',
      source: 'App Store Connect',
      baseline: { value: 1020, at: 1_700_000_000_000, evidence: { kind: 'number', value: '1020', source: 'App Store Connect', readAt: 1_700_000_000_000 } },
      value: 1400,
      due: '2026-12-31'
    },
    review: { kind: 'weekly', day: 1, time: '09:00', timeZone: 'Australia/Adelaide' },
    reviewText: 'Mondays at 09:00',
    routineId: 'r1',
    proposal: null,
    oscar: null,
    waitsForOscar: false,
    latest: null,
    dropReason: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    agreedAt: 1_700_000_100_000,
    finishedAt: null,
    ...overrides
  }
}

function review(overrides: Partial<GoalReview> = {}): GoalReview {
  return {
    at: 1_700_500_000_000,
    value: 1110,
    previous: 1020,
    moved: 'toward',
    met: false,
    stalled: false,
    did: 'Updated the store page.',
    work: { done: 4, open: 1, needsOscar: 0, failed: 0 },
    itemId: 'rev-1',
    ...overrides
  }
}

describe('goalProgress and delta', () => {
  test('computes progress for increasing and decreasing targets', () => {
    const up = goal({ latest: review({ value: 1110 }) })
    expect(goalProgress(up)).toBe(24)
    expect(goalDeltaText(up)).toBe('up 90 from the start')

    const down = goal({
      target: {
        measure: 'refund rate %',
        source: 'Stripe',
        baseline: { value: 8, at: 1000, evidence: { kind: 'number', value: '8', source: 'Stripe', readAt: 1000 } },
        value: 4,
        due: '2026-12-31'
      },
      latest: review({ value: 6, previous: 8 })
    })
    expect(goalProgress(down)).toBe(50)
    expect(goalDeltaText(down)).toBe('down 2 from the start')
  })

  test('formats days left and past due', () => {
    const nov22 = Date.UTC(2026, 10, 22, 12, 0)
    expect(daysLeftLabel('2026-11-22', 'agreed', nov22)).toBe('Due today')
    expect(daysLeftLabel('2026-11-25', 'agreed', nov22)).toBe('3 days left')
    expect(daysLeftLabel('2026-11-20', 'agreed', nov22)).toBe('2 days past due')
    expect(daysLeftLabel('2026-11-20', 'reached', nov22)).toBe('Reached')
  })

  test('excludes review items from goal work counts and checks reading verification honestly', () => {
    const revItem: WorkSummary = {
      id: 'rev-1',
      title: 'Goal review',
      ownerId: 'b1',
      ownerName: 'FillLight Bot',
      askedBy: { kind: 'routine', id: 'r1', name: 'Review' },
      origin: { kind: 'routine_run', id: 'run1' },
      parentId: null,
      goalId: 'g1',
      kind: 'figure',
      checkLevel: 2,
      defaultLevel: 2,
      check: {
        round: 1,
        by: { kind: 'bot', id: 'b2', name: 'Server Engineer' },
        state: 'verified',
        text: 'Confirmed 1110.',
        note: null,
        sameBot: false,
        model: null,
        at: 100,
        settledAt: 200
      },
      status: 'done',
      question: null,
      evidenceCount: 1,
      createdAt: 100,
      updatedAt: 200,
      startedAt: 100,
      finishedAt: 200
    }
    const workItem: WorkSummary = { ...revItem, id: 'w1', title: 'Store copy', kind: 'outside', status: 'done' }
    const waitingItem: WorkSummary = { ...revItem, id: 'w2', title: 'Price test', status: 'needs_oscar', question: '$34.99 or $39.99?' }
    const detail = { items: [revItem, workItem, waitingItem], reviews: [review()] } as Pick<GoalDetail, 'items' | 'reviews'>
    const stats = goalWorkStats(detail)
    expect(stats.total).toBe(2)
    expect(stats.done).toBe(1)
    expect(stats.needsOscar.map(i => i.id)).toEqual(['w2'])

    const g = goal({ latest: review() })
    expect(readingProvenance(g, stats.reviewItem('rev-1'))).toContain('verified by Server Engineer')
    expect(numberStatusText(g)).toBe('Moving toward target')
    expect(reviewNumberDetail(review(), g.target)).toContain('1,020 to 1,110 downloads a week (+9%)')
  })

  test('sorts waiting goals before agreed, paused last, and separates reached/dropped', () => {
    const waiting = goal({ id: 'w', state: 'proposed', waitsForOscar: true, updatedAt: 1 })
    const agreed = goal({ id: 'a', state: 'agreed', updatedAt: 3 })
    const paused = goal({ id: 'p', state: 'paused', updatedAt: 5 })
    const done = goal({ id: 'r', state: 'reached', updatedAt: 2 })
    const sorted = sortGoals([paused, done, agreed, waiting])
    expect(sorted.active.map(g => g.id)).toEqual(['w', 'a', 'p'])
    expect(sorted.finished.map(g => g.id)).toEqual(['r'])
  })

  test('gates Resume when a paused goal has a pending proposal and maps card modes safely', () => {
    const dropProposal = { agreement: null, target: null, review: null, drop: true, why: 'Retired', at: 2000 }
    expect(canResumeGoal(goal({ state: 'paused', proposal: null }))).toBe(true)
    expect(canResumeGoal(goal({ state: 'paused', proposal: dropProposal }))).toBe(false)
    expect(canResumeGoal(goal({ state: 'agreed', proposal: null }))).toBe(false)

    expect(goalCardMode(goal({ state: 'proposed', waitsForOscar: true }))).toBe('proposal')
    expect(goalCardMode(goal({ state: 'agreed', waitsForOscar: false }))).toBe('agreed')
    expect(goalCardMode(goal({ state: 'dropped', waitsForOscar: false }))).toBe('dropped')
    expect(goalCardMode(goal({ state: 'reached', waitsForOscar: false }))).toBe('reached')
    expect(goalCardMode(goal({ state: 'paused', waitsForOscar: false }))).toBe('paused')
    expect(goalCardMode(goal({ state: 'proposed', waitsForOscar: false }))).toBe('waiting_bot')
  })

  test('orders oldest-first reviews newest-first with chronological numbers and formats next review date', () => {
    const r1 = review({ itemId: 'rev-1', at: 1_700_000_000_000, value: 1050 })
    const r2 = review({ itemId: 'rev-2', at: 1_700_600_000_000, value: 1110 })
    const ordered = orderedReviews([r1, r2])
    expect(ordered.map(o => ({ id: o.review.itemId, index: o.index, isLatest: o.isLatest }))).toEqual([
      { id: 'rev-2', index: 2, isLatest: true },
      { id: 'rev-1', index: 1, isLatest: false }
    ])

    const g = goal({ reviewText: 'Mondays at 09:00' })
    const nov22 = new Date(2026, 10, 22, 10, 0).getTime()
    const nov23 = new Date(2026, 10, 23, 9, 0).getTime()
    expect(nextReviewLine(g, nov23, nov22)).toBe('Next review Tomorrow')
    expect(nextReviewLine(g, undefined, nov22)).toBe('Reviews Mondays at 09:00')
  })
})
