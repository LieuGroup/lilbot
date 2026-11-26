/** Behavioral resilience tests for PR #309 (`ios/src/work/store-core.ts`):
 *  ACTIVE_WORK_STATUSES ('failed' included), closed-socket silence, single reconnect reload, push coalescing,
 *  guarded() seq/gen dropping, mutateItem/setWorkLevel socketGen guards, and disconnected server-switch reset. */
import { describe, expect, test } from 'bun:test'
import { ACTIVE_WORK_STATUSES, createWorkStore, type WorkSocket } from '../../ios/src/work/store-core'
import { failedCheckItems } from '../../shared/client/work/work-lines'
import type { WorkLevels } from '../../shared/work-check-schema'
import type { WorkBrief, WorkItem, WorkStatus, WorkSummary } from '../../shared/work-schema'
import { makeFakeWorkSocket, makeWorkCheck, makeWorkItem, makeWorkSummary } from './work-fixtures'

describe('createWorkStore real-server filter, resilience, and race guards', () => {
  test('loadBrief requests failed items so Today surfaces status=failed items against the real server', async () => {
    expect(ACTIVE_WORK_STATUSES).toContain('failed')
    const failedItem = makeWorkSummary({
      id: 'w-fail',
      status: 'failed',
      checkLevel: 2,
      check: makeWorkCheck({ state: 'not_verified', text: 'Mismatch' })
    })
    const fake = makeFakeWorkSocket(true, async (method, params) => {
      if (method === 'work.brief') return { since: 1_000, needsOscar: [], failed: [], done: { count: 0, items: [] } } satisfies WorkBrief
      if (method === 'work.list') {
        const statuses = Array.isArray(params.status) ? (params.status as WorkStatus[]) : undefined
        return statuses ? [failedItem].filter(i => statuses.includes(i.status)) : [failedItem]
      }
      return []
    })
    const mgr = createWorkStore(() => fake.socket)
    const off = mgr.watchBrief()
    await Bun.sleep(15)
    expect(failedCheckItems(mgr.useStore.getState().active, 1_000).map(i => i.id)).toEqual(['w-fail'])
    off()
  })

  test('makes zero RPCs on closed socket, coalesces push bursts, and cancels timers on disconnect', async () => {
    const fake = makeFakeWorkSocket(false, async method => {
      if (method === 'work.brief')
        return { since: 0, needsOscar: [makeWorkSummary({ id: 'w1', status: 'needs_oscar' })], failed: [], done: { count: 0, items: [] } } satisfies WorkBrief
      if (method === 'work.open') return makeWorkItem({ id: 'w1', status: 'needs_oscar' })
      return [makeWorkSummary({ id: 'w1', status: 'needs_oscar' })]
    })
    const mgr = createWorkStore(() => fake.socket, { pushCoalesceMs: 20 })
    const offs = [mgr.watchBadge(), mgr.watchBrief(), mgr.watchItem('w1')]
    await Bun.sleep(15)
    expect(fake.calls).toHaveLength(0)

    fake.setConnected(true)
    await Bun.sleep(15)
    expect(fake.calls.filter(c => c.method === 'work.brief')).toHaveLength(1)
    expect(mgr.useStore.getState().badgeCount).toBe(1)

    for (let i = 0; i < 5; i++) fake.emitWork()
    await Bun.sleep(35)
    expect(fake.calls.filter(c => c.method === 'work.brief')).toHaveLength(2)

    const beforeDisconnect = fake.calls.length
    fake.emitWork()
    fake.setConnected(false)
    await Bun.sleep(35)
    expect(fake.calls).toHaveLength(beforeDisconnect)
    for (const off of offs) off()
  })

  test('drops out-of-order guarded() replies and clears all keys when switching to a disconnected server', async () => {
    let resolveSlowBrief!: (b: WorkBrief) => void
    let resolveSlowList!: (items: WorkSummary[]) => void
    let briefCalls = 0
    let listCalls = 0
    const s1 = makeFakeWorkSocket(true, async method => {
      if (method === 'work.brief') {
        return ++briefCalls === 1
          ? new Promise<WorkBrief>(r => {
              resolveSlowBrief = r
            })
          : ({ since: 200, needsOscar: [makeWorkSummary({ id: 'fresh', status: 'needs_oscar' })], failed: [], done: { count: 0, items: [] } } satisfies WorkBrief)
      }
      if (method === 'work.list') {
        return ++listCalls === 1
          ? new Promise<WorkSummary[]>(r => {
              resolveSlowList = r
            })
          : [makeWorkSummary({ id: 'fresh', status: 'needs_oscar' })]
      }
      if (method === 'work.levels.get') return { kinds: [] } satisfies WorkLevels
      if (method === 'work.open') return makeWorkItem({ id: 'w1', title: 'S1' })
      return []
    })
    const s2 = makeFakeWorkSocket(false, async () => [])
    let active: WorkSocket = s1.socket
    const mgr = createWorkStore(() => active)
    const offs = [mgr.watchBadge(), mgr.watchBrief(), mgr.watchLevels(), mgr.watchItem('w1')]
    await Bun.sleep(5)
    await Promise.all([mgr.loadBrief(), mgr.loadList(undefined, undefined)])
    expect(mgr.useStore.getState().brief?.since).toBe(200)
    expect(mgr.useStore.getState().list.map(i => i.id)).toEqual(['fresh'])

    resolveSlowBrief({ since: 99, needsOscar: [], failed: [], done: { count: 0, items: [] } })
    resolveSlowList([makeWorkSummary({ id: 'stale' })])
    await Bun.sleep(10)
    expect(mgr.useStore.getState().brief?.since).toBe(200)
    expect(mgr.useStore.getState().list.map(i => i.id)).toEqual(['fresh'])

    active = s2.socket
    mgr.syncSocket()
    expect(s1.workListeners.size).toBe(0)
    expect(s1.connListeners.size).toBe(0)
    expect(s2.calls).toHaveLength(0)
    expect(mgr.useStore.getState()).toMatchObject({ brief: null, active: [], list: [], listLoaded: false, levels: null, items: {}, badgeCount: 0 })
    for (const off of offs) off()
  })

  test('drops slow mutateItem and setWorkLevel replies from prior server after syncSocket()', async () => {
    let resolveAnswer!: (item: WorkItem) => void
    let resolveLevel!: (levels: WorkLevels) => void
    const s1 = makeFakeWorkSocket(true, async method => {
      if (method === 'work.answer') {
        return new Promise<WorkItem>(r => {
          resolveAnswer = r
        })
      }
      if (method === 'work.levels.set') {
        return new Promise<WorkLevels>(r => {
          resolveLevel = r
        })
      }
      return []
    })
    const s2 = makeFakeWorkSocket(false, async () => [])
    let active: WorkSocket = s1.socket
    const mgr = createWorkStore(() => active)

    const pAnswer = mgr.answerWorkItem('w1', 'Yes')
    const pLevel = mgr.setWorkLevel('deploy', 3)
    active = s2.socket
    mgr.syncSocket()

    resolveAnswer(makeWorkItem({ id: 'w1', title: 'From Server 1' }))
    resolveLevel({ kinds: [] })
    await Promise.all([pAnswer, pLevel])
    expect(mgr.useStore.getState().items.w1).toBeUndefined()
    expect(mgr.useStore.getState().levels).toBeNull()
  })
})
