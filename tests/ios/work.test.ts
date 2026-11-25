import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shouldStackWorkRow, windowStartEpoch, workSheetPadding, workTabBadge } from '../../ios/src/work/board-state'
import { clockTime, WORK_DATE_LABELS } from '../../ios/src/work/format-labels'
import { createWorkStore, type WorkSocket } from '../../ios/src/work/store-core'
import { groupByBot, groupByStatus, partitionEvidence } from '../../shared/client/work/work-groups'
import { briefSubtitle, doneBreakdown, failedCheckItems, isOscarCheck, safeHttpUrl, workBadge, workLineStatus } from '../../shared/client/work/work-lines'
import type { WorkLevels } from '../../shared/work-check-schema'
import type { WorkBrief } from '../../shared/work-schema'
import { makeWorkCheck as check, makeWorkItem as fullItem, makeWorkSummary as summary } from './work-fixtures'

describe('shared/client/work rules', () => {
  test('groups status trees and bot sections while keeping parent-child hierarchy', () => {
    const parent = summary({ id: 'p1', status: 'working', ownerId: 'b1', ownerName: 'Alpha' })
    const child = summary({ id: 'c1', parentId: 'p1', status: 'checking', ownerId: 'b2', ownerName: 'Beta' })
    const needs = summary({ id: 'n1', status: 'needs_oscar', ownerId: 'b1', ownerName: 'Alpha' })
    const done = summary({ id: 'd1', status: 'done', checkLevel: 2, check: check() })

    const byStatus = groupByStatus([parent, child, needs, done])
    expect(byStatus.needsOscar.map(i => i.id)).toEqual(['n1'])
    expect(byStatus.workingCount).toBe(2)
    expect(byStatus.working).toHaveLength(1)
    expect(byStatus.working[0]?.children.map(c => c.item.id)).toEqual(['c1'])
    expect(byStatus.done.map(i => i.id)).toEqual(['d1'])

    const byBot = groupByBot([parent, child, needs])
    expect(byBot.map(g => `${g.botName}:${g.items.length}`)).toEqual(['Alpha:2', 'Beta:1'])
  })

  test('partitions owner evidence separately from check-round evidence', () => {
    const item = fullItem({
      checks: [check({ round: 1, at: 15, settledAt: 25 })],
      evidence: [
        { id: 'e1', proves: 'build green', pointer: { kind: 'command', command: 'bun test', output: 'ok' }, byId: 'b1', at: 10 },
        { id: 'e2', proves: 'reproduced', pointer: { kind: 'link', url: 'https://example.com' }, byId: 'b2', at: 20 }
      ]
    })
    const part = partitionEvidence(item)
    expect(part.owner.map(e => e.id)).toEqual(['e1'])
    expect(part.byRound[1]?.map(e => e.id)).toEqual(['e2'])
  })

  test('derives badges (including unverified done), done breakdown, failed checks, safe URLs, and chat work lines', () => {
    const verified = summary({ id: 'd1', status: 'done', checkLevel: 2, check: check() })
    const selfChecked = summary({ id: 'd2', status: 'done', checkLevel: 1, evidenceCount: 1 })
    const notChecked = summary({ id: 'd3', status: 'done', checkLevel: 0 })
    const unverifiedDone = summary({ id: 'd4', status: 'done', checkLevel: 2, check: null })
    const failedCheckDone = summary({ id: 'd5', status: 'done', checkLevel: 2, check: check({ state: 'not_verified' }) })
    const oscarCheck = summary({
      id: 'n2',
      status: 'needs_oscar',
      checkLevel: 3,
      check: check({ by: { kind: 'oscar', id: null, name: 'Oscar' }, state: 'checking', settledAt: null })
    })
    const failed = summary({ id: 'f1', status: 'working', checkLevel: 2, check: check({ state: 'not_verified', at: 9_000, settledAt: 9_500 }) })

    expect(workBadge(verified)).toBe('verified')
    expect(workBadge(selfChecked)).toBe('self_checked')
    expect(workBadge(notChecked)).toBe('not_checked')
    expect(workBadge(unverifiedDone)).toBe('not_verified')
    expect(workBadge(failedCheckDone)).toBe('not_verified')
    expect(isOscarCheck(oscarCheck)).toBe(true)
    expect(doneBreakdown([verified, selfChecked, notChecked])).toEqual({ verified: 1, selfChecked: 1, notChecked: 1 })
    expect(failedCheckItems([failed], 5_000).map(i => i.id)).toEqual(['f1'])
    expect(briefSubtitle({ needs: 2, failed: 1, done: 3, working: 1 })).toBe('2 things need you · 1 check failed · 3 done · 1 in progress')
    expect(workLineStatus(verified, [selfChecked])).toBe('Finished · 1 part, 1 done')
    expect(safeHttpUrl('https://example.com/ok')).toBe('https://example.com/ok')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
  })
})

describe('ios/src/work board helpers and store', () => {
  test('formats native Work tab badge, time windows, AX stacking, and Duo sheet padding', () => {
    expect(workTabBadge(0)).toBeUndefined()
    expect(workTabBadge(4)).toBe('4')
    expect(workTabBadge(120)).toBe('99+')
    expect(windowStartEpoch('all', 1_000_000)).toBeUndefined()
    expect(windowStartEpoch('1d', 86_460_123)).toBe(60_000)
    expect(shouldStackWorkRow(1.0, 390)).toBe(false)
    expect(shouldStackWorkRow(1.7, 390)).toBe(true)
    expect(shouldStackWorkRow(1.0, 260)).toBe(true)
    expect(workSheetPadding({ left: 0, right: 84, bottom: 20 })).toEqual({ paddingLeft: 16, paddingRight: 96, paddingBottom: 32 })
  })

  test('tracks needs_oscar badge count live and dispatches pass/sendBack/answer/drop/level calls', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = []
    let onWork: (() => void) | undefined
    let needsCount = 2
    const brief = (): WorkBrief => ({
      since: 0,
      needsOscar: Array.from({ length: needsCount }, (_, idx) => summary({ id: `n${idx}`, status: 'needs_oscar' })),
      failed: [],
      done: { count: 0, items: [] }
    })
    const socket: WorkSocket = {
      connected: true,
      call: (async (method: string, params?: Record<string, unknown>) => {
        calls.push({ method, params: params ?? {} })
        if (method === 'work.brief') return brief()
        if (method === 'work.list') return brief().needsOscar
        if (method === 'work.open') return fullItem({ id: String(params?.itemId ?? 'w1') })
        if (method === 'work.levels.get' || method === 'work.levels.set') return { kinds: [] } satisfies WorkLevels
        return fullItem({ id: String(params?.itemId ?? 'w1'), status: 'done' })
      }) as WorkSocket['call'],
      onWorkChanged: cb => {
        onWork = cb
        return () => {
          onWork = undefined
        }
      },
      onConnection: () => () => {}
    }

    const store = createWorkStore(() => socket, { pushCoalesceMs: 5 })
    const stop = store.watchBadge()
    await Bun.sleep(10)
    expect(store.useStore.getState().badgeCount).toBe(2)

    needsCount = 1
    onWork?.()
    await Bun.sleep(20)
    expect(store.useStore.getState().badgeCount).toBe(1)

    await store.passWorkItem('w1')
    await store.sendBackWorkItem('w1', 'Missing screenshot')
    await store.answerWorkItem('w1', 'Ship it')
    await store.dropWorkItem('w1', 'No longer needed')
    await store.setWorkLevel('deploy', 3, 'b1')
    stop()

    expect(calls.map(c => c.method)).toContain('work.pass')
    expect(calls.map(c => c.method)).toContain('work.sendBack')
    expect(calls.map(c => c.method)).toContain('work.answer')
    expect(calls.map(c => c.method)).toContain('work.drop')
    expect(calls.map(c => c.method)).toContain('work.levels.set')
  })

  test('uses shared/client history label formatters directly', () => {
    const sample = Date.UTC(2026, 10, 25, 12, 0, 0)
    expect(clockTime(sample)).toMatch(/^\d{2}:\d{2}$/)
    expect(WORK_DATE_LABELS.dayKey(sample)).toBeGreaterThan(20260000)
  })
})

describe('client boundary for ios/src/work', () => {
  test('ios/src/work never imports from web/ or server/', () => {
    const dir = join(import.meta.dir, '../../ios/src/work')
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue
      const source = readFileSync(join(dir, file), 'utf8')
      expect(source).not.toMatch(/from\s+['"][^'"]*\/(web|server)\//)
    }
  })
})
