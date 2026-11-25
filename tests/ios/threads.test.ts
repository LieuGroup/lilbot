/** Unit tests for iOS threads store, 1-tap Answer dock pill model, Dynamic Type/Duo sheet safety, and stop copy. */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildDockPillModel, duoSafeSheetPadding, shouldWrapDockPill } from '../../ios/src/threads/dock-pill'
import { createThreadStore, type DockStorageAdapter, type ThreadSocket } from '../../ios/src/threads/store-core'
import { dockItems } from '../../shared/client/threads/dock-items'
import { stopThreadCopy } from '../../shared/client/threads/stop-copy'
import { COLLAPSED_PREFIX, DISMISSED_PREFIX } from '../../shared/client/threads/waiting-work'
import type { BotThread } from '../../shared/thread-schema'
import type { WorkSummary } from '../../shared/work-schema'

const MIN = 60_000
const T0 = new Date(2026, 10, 24, 10, 0).getTime()
const atlas = { id: 'atlas', name: 'Atlas' }
const foundry = { id: 'foundry', name: 'Foundry' }
const ledger = { id: 'ledger', name: 'Ledger' }

const makeThread = (id: string, extra: Partial<BotThread> = {}): BotThread => ({
  id,
  participants: extra.worker ? [atlas, atlas] : [atlas, foundry],
  createdAt: T0,
  depth: 1,
  state: 'open',
  messages: [{ id: `m-${id}`, authorId: atlas.id, authorName: atlas.name, createdAt: T0, items: [{ kind: 'assistant', text: `Task ${id}` }] }],
  batchId: `batch-${id}`,
  parentId: null,
  status: 'working',
  activity: 'Running tests',
  startedAt: T0,
  endedAt: null,
  stoppedBy: null,
  ...extra
})

const makeWork = (id: string, extra: Partial<WorkSummary> = {}): WorkSummary => ({
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
  question: 'Confirm region',
  evidenceCount: 0,
  createdAt: T0,
  updatedAt: T0 + MIN,
  startedAt: T0,
  finishedAt: null,
  ...extra
})

function makeFakeSocket(threads: BotThread[], initialWaiting: WorkSummary[]) {
  let waiting = initialWaiting
  const calls: { method: string; params: unknown }[] = []
  const socket: ThreadSocket = {
    connected: true,
    async call(method: string, params: unknown): Promise<any> {
      calls.push({ method, params })
      if (method === 'threads.list') return threads
      if (method === 'threads.open') {
        const found = threads.find(t => t.id === (params as { threadId: string }).threadId)
        if (!found) throw new Error('Not found')
        return found
      }
      if (method === 'threads.cancel') return { ok: true }
      if (method === 'work.list') return waiting
      if (method === 'work.answer') {
        waiting = waiting.filter(w => w.id !== (params as { itemId: string }).itemId)
        return { ok: true }
      }
      throw new Error(`Unexpected method ${method}`)
    },
    onThreadsChanged: () => () => {},
    onWorkChanged: () => () => {},
    onConnection: () => () => {}
  }
  return { socket, calls }
}

describe('collapsed Tasks pill 1-tap Answer model & Duo/Dynamic Type guards', () => {
  test('exposes 1-tap Answer on collapsed pill whenever an answerable question waits on Oscar', () => {
    const waitingWorker = makeThread('w1', { worker: true, status: 'finished', endedAt: T0 })
    const runningWorker = makeThread('w2', { worker: true, status: 'working', createdAt: T0 + MIN })
    const items = dockItems([runningWorker, waitingWorker], atlas.id, { w1: makeWork('w1') }, {}, T0 + 2 * MIN)

    const pill = buildDockPillModel(items, atlas.id)
    expect(pill).toMatchObject({ icon: 'waiting', lead: '2 · Confirm region' })
    expect(pill?.answerTarget?.work.id).toBe('w1')
    expect(pill?.answerTarget?.title).toBe('Worker · Task w1')

    const soloPill = buildDockPillModel(dockItems([waitingWorker], atlas.id, { w1: makeWork('w1', { question: '   ' }) }, {}, T0 + 2 * MIN), atlas.id)
    expect(soloPill?.lead).toBe('Task w1')
    expect(soloPill?.answerTarget?.work.id).toBe('w1')
  })

  test('omits 1-tap Answer for level-3 Oscar checks and plain running tasks, keeping exact web collapsed wording', () => {
    const checkWorker = makeThread('chk1', { worker: true, status: 'finished', endedAt: T0 })
    const checkWork = makeWork('chk1', {
      question: null,
      check: { round: 1, by: { kind: 'oscar', id: null, name: 'Oscar' }, state: 'checking', text: null, note: null, sameBot: false, model: null, at: T0, settledAt: null }
    })
    expect(buildDockPillModel(dockItems([checkWorker], atlas.id, { chk1: checkWork }, {}, T0 + MIN), atlas.id)).toMatchObject({
      answerTarget: null,
      lead: '1 waiting for you',
      detail: 'Worker'
    })

    const run1 = makeThread('r1', { worker: true, status: 'working' })
    const run2 = makeThread('r2', { participants: [atlas, foundry], status: 'working' })
    expect(buildDockPillModel(dockItems([run1, run2], atlas.id, {}, {}, T0 + MIN), atlas.id)).toMatchObject({
      answerTarget: null,
      icon: 'working',
      lead: '2 running',
      detail: 'Worker, Foundry'
    })
    expect(buildDockPillModel([], atlas.id)).toBeNull()
  })

  test('wraps dock pill at AX text sizes or narrow widths and clears Folded Duo right rail on pageSheets', () => {
    expect(shouldWrapDockPill({ fontScale: 1.0, availableWidth: 390 })).toBe(false)
    expect(shouldWrapDockPill({ fontScale: 1.35, availableWidth: 382 })).toBe(false)
    expect(shouldWrapDockPill({ fontScale: 1.6, availableWidth: 390 })).toBe(true)
    expect(shouldWrapDockPill({ fontScale: 3.1, availableWidth: 382 })).toBe(true)
    expect(shouldWrapDockPill({ fontScale: 1.0, availableWidth: 240 })).toBe(true)

    expect(duoSafeSheetPadding({ left: 0, right: 84, bottom: 34 })).toEqual({ paddingLeft: 16, paddingRight: 96, paddingBottom: 46 })
    expect(duoSafeSheetPadding({ left: 0, right: 0, bottom: 34 })).toEqual({ paddingLeft: 16, paddingRight: 20, paddingBottom: 46 })
  })
})

describe('createThreadStore lifecycle, persistence, stop and answer actions', () => {
  test('watches bots with ref counting, hydrates mobile collapsed default, persists collapse & dismiss, and handles answer/stop', async () => {
    const t1 = makeThread('t1', { worker: true, status: 'finished', endedAt: T0 + MIN })
    const fake = makeFakeSocket([t1], [makeWork('t1', { question: 'Ship eu-west?' })])
    const data = new Map<string, string>()
    const adapter: DockStorageAdapter = {
      getItem: async key => data.get(key) ?? null,
      setItem: async (key, value) => {
        data.set(key, value)
      }
    }
    const manager = createThreadStore(() => fake.socket, adapter)

    const unsub1 = manager.watchBot(atlas.id)
    const unsub2 = manager.watchBot(atlas.id)
    await Promise.resolve()
    await Promise.resolve()

    expect(manager.useStore.getState().byBot[atlas.id]).toHaveLength(1)
    expect(manager.useStore.getState().waitingWork.t1?.question).toBe('Ship eu-west?')
    expect(manager.useStore.getState().dockCollapsed[atlas.id]).toBe(true)
    expect(fake.calls.filter(c => c.method === 'threads.list')).toHaveLength(1)

    manager.setDockCollapsed(atlas.id, false)
    expect(data.get(`${COLLAPSED_PREFIX}${atlas.id}`)).toBe('expanded')
    manager.dismissDockItem(atlas.id, 't1', T0 + MIN)
    expect(JSON.parse(data.get(`${DISMISSED_PREFIX}${atlas.id}`) ?? '{}')).toEqual({ t1: T0 + MIN })

    manager.openView(atlas.id, 't1')
    await Promise.resolve()
    expect(manager.useStore.getState().opened[manager.openKey(atlas.id, 't1')]?.id).toBe('t1')

    await manager.answerWork('t1', 'Yes, eu-west')
    expect(manager.useStore.getState().waitingWork.t1).toBeUndefined()
    await manager.stopThread(atlas.id, 't1')
    expect(fake.calls.some(c => c.method === 'threads.cancel')).toBe(true)

    manager.closeView()
    expect(manager.useStore.getState().activeView).toBeNull()
    unsub1()
    unsub2()
  })
})

describe('shared stopThreadCopy and client boundary rules', () => {
  test('formats worker, delegated task, and group stop confirmations and keeps ios/src/threads free of web/server imports', () => {
    expect(stopThreadCopy(makeThread('w1', { worker: true }))).toMatchObject({ what: 'worker', title: 'Stop this worker?', subject: 'Task w1', confirmLabel: 'Stop worker' })
    expect(stopThreadCopy(makeThread('t1', { participants: [atlas, foundry] })).title).toBe('Stop this task?')
    const group = makeThread('g1', {
      participants: [atlas, foundry, ledger],
      group: { purpose: 'Pricing launch', roundCap: 6, rounds: [], turns: 0, lastAt: T0, end: null, kept: [], folder: '', seen: {} }
    })
    expect(stopThreadCopy(group).description).toContain('All three bots stop working on it now. Atlas is told you stopped it')

    const dir = resolve(process.cwd(), 'ios/src/threads')
    for (const file of readdirSync(dir)) {
      const source = readFileSync(resolve(dir, file), 'utf8')
      expect(source).not.toMatch(/from\s+['"][^'"]*web\//)
      expect(source).not.toMatch(/from\s+['"][^'"]*server\//)
    }
  })
})
