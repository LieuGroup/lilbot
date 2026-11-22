import { describe, expect, test } from 'bun:test'
import type { WorkCheck } from '../../shared/work-check-schema'
import type { WorkSummary } from '../../shared/work-schema'
import {
  briefSubtitle,
  checkSummaryLine,
  doneBreakdown,
  failedCheckItems,
  groupByBot,
  groupByStatus,
  isOscarCheck,
  levelReason,
  nestItems,
  workBadge
} from '../../web/src/work/work-lines'

function item(overrides: Partial<WorkSummary> = {}): WorkSummary {
  return {
    id: 'w1',
    title: 'Test item',
    ownerId: 'b1',
    ownerName: 'Alpha',
    askedBy: { kind: 'oscar', id: null, name: 'Oscar' },
    origin: { kind: 'conversation', id: 'c1' },
    parentId: null,
    goalId: null,
    kind: 'file',
    checkLevel: 1,
    defaultLevel: 1,
    check: null,
    status: 'done',
    question: null,
    evidenceCount: 1,
    createdAt: 1000,
    updatedAt: 2000,
    startedAt: 1100,
    finishedAt: 2000,
    ...overrides
  }
}

function check(overrides: Partial<WorkCheck> = {}): WorkCheck {
  return {
    round: 1,
    by: { kind: 'bot', id: 'b2', name: 'Beta' },
    state: 'verified',
    text: 'Checked.',
    note: null,
    sameBot: false,
    model: null,
    at: 1500,
    settledAt: 1900,
    ...overrides
  }
}

describe('workBadge', () => {
  test('green Verified appears only for level 2+ items verified by a bot or passed by Oscar', () => {
    expect(workBadge(item({ status: 'done', checkLevel: 2, check: check({ state: 'verified' }) }))).toBe('verified')
    expect(workBadge(item({ status: 'done', checkLevel: 3, check: check({ by: { kind: 'oscar', id: null, name: 'Oscar' }, state: 'passed' }) }))).toBe('verified')
    expect(workBadge(item({ status: 'done', checkLevel: 2, check: null }))).toBe('not_verified')
    expect(workBadge(item({ status: 'done', checkLevel: 1, check: null }))).toBe('self_checked')
    expect(workBadge(item({ status: 'done', checkLevel: 0, check: null }))).toBe('not_checked')
  })

  test('marks checking, not_verified and could_not_check on active items', () => {
    expect(workBadge(item({ status: 'checking', checkLevel: 2, check: check({ state: 'checking' }) }))).toBe('checking')
    expect(workBadge(item({ status: 'working', checkLevel: 2, check: check({ state: 'not_verified' }) }))).toBe('not_verified')
    expect(workBadge(item({ status: 'needs_oscar', checkLevel: 2, check: check({ state: 'could_not_check' }) }))).toBe('could_not_check')
    expect(workBadge(item({ status: 'working', checkLevel: 1, check: null }))).toBeNull()
  })
})

describe('board helpers', () => {
  test('distinguishes Oscar check items from question items', () => {
    const oscarCheck = item({
      status: 'needs_oscar',
      checkLevel: 3,
      check: check({ by: { kind: 'oscar', id: null, name: 'Oscar' }, state: 'checking', settledAt: null })
    })
    const question = item({ status: 'needs_oscar', question: 'Which price?', check: null })
    expect(isOscarCheck(oscarCheck)).toBe(true)
    expect(isOscarCheck(question)).toBe(false)
  })

  test('finds failed checks including items sent back to working', () => {
    const sentBack = item({ id: 'w1', status: 'working', checkLevel: 2, check: check({ state: 'not_verified', text: 'Only one worker running.' }) })
    const failed = item({ id: 'w2', status: 'failed', updatedAt: 5000 })
    const oldFailed = item({ id: 'w3', status: 'failed', updatedAt: 500 })
    const verified = item({ id: 'w4', status: 'done', checkLevel: 2, check: check({ state: 'verified' }) })
    expect(failedCheckItems([sentBack, failed, oldFailed, verified], 1000).map(i => i.id)).toEqual(['w1', 'w2'])
    expect(checkSummaryLine(sentBack)).toBe('Not verified by Beta: Only one worker running. Sent back to Alpha.')
  })

  test('summarizes done breakdown and brief subtitle', () => {
    const done = [item({ id: '1', checkLevel: 2, check: check({ state: 'verified' }) }), item({ id: '2', checkLevel: 1 }), item({ id: '3', checkLevel: 0 })]
    expect(doneBreakdown(done)).toEqual({ verified: 1, selfChecked: 1, notChecked: 1 })
    expect(briefSubtitle({ needs: 2, failed: 1, done: 14, working: 3 })).toBe('2 things need you · 1 check failed · 14 done · 3 in progress')
    expect(briefSubtitle({ needs: 0, failed: 0, done: 0, working: 0 })).toBe('All quiet today')
  })

  test('nests children under their parent and groups by status or bot', () => {
    const parent = item({ id: 'p', status: 'working', ownerId: 'b1', ownerName: 'Alpha' })
    const child = item({ id: 'c', parentId: 'p', status: 'working', ownerId: 'b2', ownerName: 'Beta' })
    const waiting = item({ id: 'n', status: 'needs_oscar', ownerId: 'b2', ownerName: 'Beta' })
    expect(nestItems([parent, child])).toEqual([{ item: parent, children: [child] }])
    const byStatus = groupByStatus([parent, child, waiting])
    expect(byStatus.needsOscar.map(i => i.id)).toEqual(['n'])
    expect(byStatus.working.map(r => r.item.id)).toEqual(['p'])
    expect(byStatus.working[0].children.map(c => c.id)).toEqual(['c'])
    const byBot = groupByBot([parent, child, waiting])
    expect(byBot.map(g => g.botName)).toEqual(['Beta', 'Alpha'])
  })

  test('explains default vs raised check levels', () => {
    expect(levelReason({ kind: 'outside', checkLevel: 2, defaultLevel: 2 })).toContain('your default')
    expect(levelReason({ kind: 'file', checkLevel: 2, defaultLevel: 1 })).toContain('Raised from Level 1')
    expect(levelReason({ kind: null, checkLevel: 0, defaultLevel: null })).toContain('before work kinds')
  })
})
