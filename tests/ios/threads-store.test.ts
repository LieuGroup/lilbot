/** Resilience tests for `createThreadStore`: closed socket, reconnect, push burst coalescing,
 *  server switch reset/unsub, and per-key out-of-order sequence guards. */
import { describe, expect, test } from 'bun:test'
import { createThreadStore, type ThreadSocket } from '../../ios/src/threads/store-core'
import type { BotThread } from '../../shared/thread-schema'
import type { WorkSummary } from '../../shared/work-schema'

const T0 = new Date(2026, 10, 24, 10, 0).getTime()
const atlas = { id: 'atlas', name: 'Atlas' }
const foundry = { id: 'foundry', name: 'Foundry' }

const makeThread = (id: string, activity = 'Working') => ({ id, participants: [atlas, foundry], createdAt: T0, status: 'working', activity }) as unknown as BotThread
const makeWork = (id: string, question = 'Pick region') =>
  ({ id, status: 'needs_oscar', question, origin: { kind: 'exchange', id }, check: null, updatedAt: T0 + 1000 }) as unknown as WorkSummary

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeControlledSocket(initialConnected = true) {
  const threads = new Set<() => void>()
  const work = new Set<() => void>()
  const conn = new Set<(connected: boolean) => void>()
  const calls: { method: string; params: unknown }[] = []
  let handler: (method: string, params: unknown) => Promise<unknown> = async () => []
  const sub =
    <T>(set: Set<T>) =>
    (fn: T) => {
      set.add(fn)
      return () => set.delete(fn)
    }
  const socket: ThreadSocket = {
    connected: initialConnected,
    call(method: string, params: unknown): Promise<any> {
      calls.push({ method, params })
      return handler(method, params)
    },
    onThreadsChanged: sub(threads),
    onWorkChanged: sub(work),
    onConnection: sub(conn)
  }
  return {
    socket,
    calls,
    listenerCounts: () => ({ threads: threads.size, work: work.size, conn: conn.size }),
    setHandler: (fn: (method: string, params: unknown) => Promise<unknown>) => {
      handler = fn
    },
    emitThreadsChanged: () => {
      for (const fn of threads) fn()
    },
    emitWorkChanged: () => {
      for (const fn of work) fn()
    },
    setConnected: (next: boolean) => {
      socket.connected = next
      for (const fn of conn) fn(next)
    }
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

describe('createThreadStore resilience: closed socket, reconnect, bursts, server switch, and ordering', () => {
  test('makes zero background calls on a closed socket, writes no spurious errors, and reloads once on reconnect', async () => {
    const ctrl = makeControlledSocket(false)
    ctrl.setHandler(async method => (method === 'threads.list' ? [makeThread('t1')] : method === 'threads.open' ? makeThread('t1', 'Detailed') : [makeWork('t1')]))
    const manager = createThreadStore(() => ctrl.socket, undefined, { threadsDebounceMs: 12, workDebounceMs: 10 })

    const stopWatch = manager.watchBot(atlas.id)
    manager.openView(atlas.id, 't1')
    await Promise.all([manager.loadBot(atlas.id), manager.loadOpen(atlas.id, 't1'), manager.loadWaitingWork()])
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
    ctrl.setHandler(async method =>
      method === 'threads.list' ? (++listCalls === 1 ? inflight.promise : [makeThread('t1')]) : method === 'threads.open' ? makeThread('t1') : [makeWork('t1')]
    )
    const manager = createThreadStore(() => ctrl.socket, undefined, { threadsDebounceMs: 20, workDebounceMs: 15 })
    const stopWatch = manager.watchBot(atlas.id)
    manager.openView(atlas.id, 't1')
    ctrl.setConnected(false)
    inflight.reject(new Error('Not connected to LilBot.'))
    await flush()
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

  test('clears all prior-server state, unsubscribes old listeners, and drops stale out-of-order replies', async () => {
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
    await flush()

    slowList.resolve([makeThread('stale-list', 'Old')])
    slowOpen.resolve(makeThread('t1', 'Old open'))
    slowWork.resolve([makeWork('w-old', 'Old question')])
    await flush()
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
