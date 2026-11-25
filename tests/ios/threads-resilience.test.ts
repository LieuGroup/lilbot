/** Mutation-killing resilience tests for PR #303: keyboard sheet math, offline/reconnect/server-switch/ordering
 *  guards in `createThreadStore`, single-send sheet locks, answered-elsewhere notices, and 44 pt hit targets. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { answerInputMaxHeight, sheetKeyboardOverlap } from '../../ios/src/threads/sheet-keyboard'
import { createThreadStore, type ThreadSocket } from '../../ios/src/threads/store-core'
import type { BotThread } from '../../shared/thread-schema'
import type { WorkSummary } from '../../shared/work-schema'

const T0 = new Date(2026, 10, 24, 10, 0).getTime()
const atlas = { id: 'atlas', name: 'Atlas' }
const foundry = { id: 'foundry', name: 'Foundry' }

const makeThread = (id: string, activity = 'Working'): BotThread => ({
  id,
  participants: [atlas, foundry],
  createdAt: T0,
  depth: 1,
  state: 'open',
  messages: [{ id: `m-${id}`, authorId: atlas.id, authorName: atlas.name, createdAt: T0, items: [{ kind: 'assistant', text: `Task ${id}` }] }],
  batchId: `batch-${id}`,
  parentId: null,
  status: 'working',
  activity,
  startedAt: T0,
  endedAt: null,
  stoppedBy: null
})

const makeWork = (id: string, question = 'Pick region'): WorkSummary => ({
  id,
  title: `Task ${id}`,
  ownerId: atlas.id,
  ownerName: atlas.name,
  askedBy: { kind: 'self', id: atlas.id, name: atlas.name },
  origin: { kind: 'exchange', id },
  parentId: null,
  goalId: null,
  kind: 'code',
  checkLevel: 1,
  defaultLevel: 1,
  check: null,
  status: 'needs_oscar',
  question,
  evidenceCount: 0,
  createdAt: T0,
  updatedAt: T0 + 1000,
  startedAt: T0,
  finishedAt: null
})

function deferred<T>() {
  let resolveFn!: (v: T) => void
  let rejectFn!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolveFn = res
    rejectFn = rej
  })
  return { promise, resolve: resolveFn, reject: rejectFn }
}

function makeControlledSocket(initialConnected = true) {
  const threadListeners = new Set<() => void>()
  const workListeners = new Set<() => void>()
  const connListeners = new Set<(connected: boolean) => void>()
  const calls: { method: string; params: unknown }[] = []
  let handler: (method: string, params: unknown) => Promise<unknown> = async () => []

  const socket: ThreadSocket = {
    connected: initialConnected,
    call(method: string, params: unknown): Promise<any> {
      calls.push({ method, params })
      return handler(method, params)
    },
    onThreadsChanged: fn => {
      threadListeners.add(fn)
      return () => threadListeners.delete(fn)
    },
    onWorkChanged: fn => {
      workListeners.add(fn)
      return () => workListeners.delete(fn)
    },
    onConnection: fn => {
      connListeners.add(fn)
      return () => connListeners.delete(fn)
    }
  }

  return {
    socket,
    calls,
    listenerCounts: () => ({ threads: threadListeners.size, work: workListeners.size, conn: connListeners.size }),
    setHandler: (fn: (method: string, params: unknown) => Promise<unknown>) => {
      handler = fn
    },
    emitThreadsChanged: () => {
      for (const fn of threadListeners) fn()
    },
    emitWorkChanged: () => {
      for (const fn of workListeners) fn()
    },
    setConnected: (next: boolean) => {
      socket.connected = next
      for (const fn of connListeners) fn(next)
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('pageSheet keyboard overlap and bounded answer input geometry', () => {
  test('computes exact overlap on Folded Duo, iPhone, centered iPad pageSheet, and mid-slide fallback', () => {
    expect(sheetKeyboardOverlap(678, null)).toBe(0)
    expect(sheetKeyboardOverlap(678, { height: 318, screenY: 360 }, { y: 24, height: 654 })).toBe(318)
    expect(sheetKeyboardOverlap(678, { height: 318, screenY: 360 }, { y: 678, height: 654 })).toBe(318)
    expect(sheetKeyboardOverlap(1024, { height: 324, screenY: 700 }, { y: 140, height: 744 })).toBe(184)
    expect(sheetKeyboardOverlap(1024, { height: 324, screenY: 920 }, { y: 140, height: 744 })).toBe(0)
  })

  test('bounds multiline input height on Folded Duo at default and AX5 so pinned footer stays visible', () => {
    const duoDefault = answerInputMaxHeight({ sheetHeight: 654, keyboardOverlap: 318, fontScale: 1.0 })
    const duoAx5 = answerInputMaxHeight({ sheetHeight: 654, keyboardOverlap: 318, fontScale: 3.1 })
    const restHeight = answerInputMaxHeight({ sheetHeight: 654, keyboardOverlap: 0, fontScale: 1.0 })
    expect(duoDefault).toBeGreaterThanOrEqual(84)
    expect(duoDefault).toBeLessThanOrEqual(148)
    expect(duoAx5).toBeGreaterThanOrEqual(84)
    expect(duoAx5).toBeLessThanOrEqual(duoDefault)
    expect(restHeight).toBeGreaterThan(duoDefault)
  })
})

describe('createThreadStore resilience: closed socket, reconnect, bursts, server switch, and ordering', () => {
  test('makes zero background calls on a closed socket, writes no spurious errors, and reloads once on reconnect', async () => {
    const ctrl = makeControlledSocket(false)
    ctrl.setHandler(async method => (method === 'threads.list' ? [makeThread('t1')] : method === 'threads.open' ? makeThread('t1', 'Detailed') : [makeWork('t1')]))
    const manager = createThreadStore(() => ctrl.socket, undefined, { threadsDebounceMs: 12, workDebounceMs: 10 })

    const stopWatch = manager.watchBot(atlas.id)
    manager.openView(atlas.id, 't1')
    await manager.loadBot(atlas.id)
    await manager.loadOpen(atlas.id, 't1')
    await manager.loadWaitingWork()
    expect(ctrl.calls).toHaveLength(0)
    expect(manager.useStore.getState().errors).toEqual({})
    expect(manager.useStore.getState().openErrors).toEqual({})
    await expect(manager.answerWork('t1', 'ok')).rejects.toThrow('Not connected to LilBot.')
    await expect(manager.stopThread(atlas.id, 't1')).rejects.toThrow('Not connected to LilBot.')

    ctrl.setConnected(true)
    await sleep(35)
    expect(ctrl.calls.filter(c => c.method === 'threads.list')).toHaveLength(1)
    expect(ctrl.calls.filter(c => c.method === 'threads.open')).toHaveLength(1)
    expect(ctrl.calls.filter(c => c.method === 'work.list')).toHaveLength(1)
    expect(manager.useStore.getState().workLoaded).toBe(true)
    stopWatch()
  })

  test('coalesces push bursts and cancels pending timers on disconnect without stamping disconnect errors', async () => {
    const ctrl = makeControlledSocket(true)
    const inflight = deferred<BotThread[]>()
    let listCalls = 0
    ctrl.setHandler(async method => {
      if (method === 'threads.list') return ++listCalls === 1 ? inflight.promise : [makeThread('t1')]
      if (method === 'threads.open') return makeThread('t1')
      return [makeWork('t1')]
    })
    const manager = createThreadStore(() => ctrl.socket, undefined, { threadsDebounceMs: 20, workDebounceMs: 15 })
    const stopWatch = manager.watchBot(atlas.id)
    manager.openView(atlas.id, 't1')
    ctrl.setConnected(false)
    inflight.reject(new Error('Not connected to LilBot.'))
    await Promise.resolve()
    await Promise.resolve()
    expect(manager.useStore.getState().errors[atlas.id]).toBeUndefined()

    ctrl.setConnected(true)
    await sleep(40)
    ctrl.calls.length = 0
    for (let i = 0; i < 5; i += 1) {
      ctrl.emitThreadsChanged()
      ctrl.emitWorkChanged()
    }
    await sleep(45)
    expect(ctrl.calls.filter(c => c.method === 'threads.list')).toHaveLength(1)
    expect(ctrl.calls.filter(c => c.method === 'threads.open')).toHaveLength(1)
    expect(ctrl.calls.filter(c => c.method === 'work.list')).toHaveLength(1)

    ctrl.calls.length = 0
    ctrl.emitThreadsChanged()
    ctrl.emitWorkChanged()
    ctrl.setConnected(false)
    await sleep(40)
    expect(ctrl.calls).toHaveLength(0)
    stopWatch()
  })

  test('clears all prior-server state, unsubscribes old listeners, and drops stale responses on server switch and out-of-order replies', async () => {
    const s1 = makeControlledSocket(true)
    const s2 = makeControlledSocket(true)
    let current: ThreadSocket | null = s1.socket

    const slowList = deferred<BotThread[]>()
    const slowOpen = deferred<BotThread>()
    const slowWork = deferred<WorkSummary[]>()
    let lCount = 0
    let oCount = 0
    let wCount = 0
    s1.setHandler(async method => {
      if (method === 'threads.list') return ++lCount === 1 ? slowList.promise : [makeThread('fresh-list', 'New')]
      if (method === 'threads.open') return ++oCount === 1 ? slowOpen.promise : makeThread('t1', 'New open')
      return ++wCount === 1 ? slowWork.promise : [makeWork('w-new', 'New question')]
    })
    s2.setHandler(async () => [])

    const manager = createThreadStore(() => current, undefined, { threadsDebounceMs: 15, workDebounceMs: 15 })
    const stopWatch = manager.watchBot(atlas.id)
    manager.openView(atlas.id, 't1')
    void manager.loadBot(atlas.id)
    void manager.loadOpen(atlas.id, 't1')
    void manager.loadWaitingWork()
    await Promise.resolve()
    await Promise.resolve()

    slowList.resolve([makeThread('stale-list', 'Old')])
    slowOpen.resolve(makeThread('t1', 'Old open'))
    slowWork.resolve([makeWork('w-old', 'Old question')])
    await Promise.resolve()
    await Promise.resolve()
    expect(manager.useStore.getState().byBot[atlas.id]?.[0]?.id).toBe('fresh-list')
    expect(manager.useStore.getState().opened[manager.openKey(atlas.id, 't1')]?.activity).toBe('New open')
    expect(Object.keys(manager.useStore.getState().waitingWork)).toEqual(['w-new'])

    manager.setDockCollapsed(atlas.id, false)
    current = s2.socket
    manager.syncSocket()
    expect(s1.listenerCounts()).toEqual({ threads: 0, work: 0, conn: 0 })
    expect(s2.listenerCounts()).toEqual({ threads: 1, work: 1, conn: 1 })
    expect(manager.useStore.getState()).toMatchObject({
      byBot: {},
      opened: {},
      errors: {},
      openErrors: {},
      waitingWork: {},
      workLoaded: false,
      activeView: null,
      dockCollapsed: {}
    })
    s1.emitThreadsChanged()
    await sleep(30)
    expect(s2.calls).toHaveLength(0)
    stopWatch()
  })
})

describe('PR #303 sheet single-send, keyboard, store hook, and 44 pt touch target contracts', () => {
  test('enforces pinned footer, keyboard dismissal, single-send locks, store hook deps, and 44 pt hit targets', () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
    const answerSrc = read('ios/src/threads/answer-work-sheet.tsx')
    const stopSrc = read('ios/src/threads/stop-thread-sheet.tsx')
    const storeSrc = read('ios/src/threads/store.ts')
    const dockSrc = read('ios/src/threads/task-dock.tsx')
    const pillSrc = read('ios/src/threads/task-dock-pill.tsx')
    const lineSrc = read('ios/src/threads/thread-line.tsx')

    expect(answerSrc).toContain('allowSwipeDismissal={!busy}')
    expect(answerSrc).toContain('if (busyRef.current) return')
    expect(answerSrc).toContain('keyboardDismissMode="on-drag"')
    expect(answerSrc).toContain('testID="answer-keyboard-done"')
    expect(answerSrc).toContain('testID="answer-work-stale-notice"')
    expect(answerSrc.indexOf('</ScrollView>')).toBeLessThan(answerSrc.indexOf('testID="answer-work-footer"'))

    expect(stopSrc).toContain('allowSwipeDismissal={!busy}')
    expect(stopSrc).toContain('if (busyRef.current) return')

    expect(storeSrc).not.toContain('state.connected')
    expect(storeSrc).toContain('manager.syncSocket()')

    expect(dockSrc).toMatch(/testID="tasks-dock-collapse"[\s\S]*?minHeight:\s*44/)
    expect(pillSrc).toContain('hitSlop={{ top: 8, bottom: 8')
    expect(lineSrc).toMatch(/testID=\{`thread-line-\$\{thread\.id\}`\}[\s\S]*?minHeight:\s*44/)
  })
})
