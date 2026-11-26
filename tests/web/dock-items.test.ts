import { expect, test } from 'bun:test'
import type { BotThread } from '../../shared/thread-schema'
import type { WorkSummary } from '../../shared/work-schema'
import { dockCollapsedSummary, dockEntries, dockHeaderSummary, dockItems, dockRowState, dockRowTitle, FINISHED_TTL_MS, nextDockExpiryAt } from '../../web/src/threads/dock-items'

const MIN = 60_000
const T0 = new Date(2026, 10, 22, 10, 0).getTime()
const lead = { id: 'lead', name: 'FillLight Bot' }
const eng = { id: 'eng', name: 'Server Engineer' }
const gone = { id: 'gone', name: 'Old Bot' }

function makeThread(id: string, extra: Partial<BotThread> = {}): BotThread {
  const worker = extra.worker === true
  return {
    id,
    participants: worker ? [lead, lead] : [lead, eng],
    createdAt: T0,
    depth: 1,
    state: 'open',
    messages: [{ id: `m-${id}`, authorId: lead.id, authorName: lead.name, createdAt: T0, items: [{ kind: 'assistant', text: `Task ${id}` }] }],
    batchId: `batch-${id}`,
    parentId: null,
    status: 'working',
    activity: 'Running tests',
    startedAt: T0,
    endedAt: null,
    stoppedBy: null,
    ...extra
  }
}

function waitingWork(id: string, extra: Partial<WorkSummary> = {}): WorkSummary {
  return {
    id,
    title: `Task ${id}`,
    ownerId: lead.id,
    ownerName: lead.name,
    askedBy: { kind: 'self', id: lead.id, name: lead.name },
    origin: { kind: 'exchange', id },
    parentId: null,
    goalId: null,
    kind: 'code',
    checkLevel: 1,
    defaultLevel: 1,
    check: null,
    status: 'needs_oscar',
    question: 'Confirm empty-file behavior',
    evidenceCount: 0,
    createdAt: T0,
    updatedAt: T0 + MIN,
    startedAt: T0,
    finishedAt: null,
    ...extra
  }
}

test('empty, stopped, group threads and exchanges between other bots are excluded from the dock', () => {
  const stopped = makeThread('stopped', { worker: true, status: 'cancelled', stoppedBy: { kind: 'oscar', id: null, name: 'the owner', at: T0 + MIN } })
  const incoming = makeThread('incoming', { participants: [eng, gone], status: 'working' })
  const group = makeThread('group', {
    group: { purpose: 'Discuss', roundCap: 6, rounds: [], turns: 0, lastAt: T0, end: null, kept: [], folder: '', seen: {} }
  })
  expect(dockItems([], lead.id, {}, {}, T0 + MIN)).toEqual([])
  expect(dockItems([stopped, incoming, group], lead.id, {}, {}, T0 + MIN)).toEqual([])
})

test('finished rows stay 2 minutes, leave on expiry or dismiss, and reappear if continued', () => {
  const done = makeThread('w1', { worker: true, status: 'finished', endedAt: T0 + MIN })
  // Still visible at 1m59s after completion.
  const almost = dockItems([done], lead.id, {}, {}, T0 + MIN + FINISHED_TTL_MS - 1_000)
  expect(almost).toHaveLength(1)
  expect(nextDockExpiryAt(almost)).toBe(T0 + MIN + FINISHED_TTL_MS)
  // Backward clock jump (now < endedAt) never expires a newly finished row early.
  expect(dockItems([done], lead.id, {}, {}, T0)).toHaveLength(1)
  // Auto-leaves at 2m00s.
  expect(dockItems([done], lead.id, {}, {}, T0 + MIN + FINISHED_TTL_MS)).toEqual([])
  // Dismissing hides it immediately for that end stamp.
  const dismissed = { w1: done.endedAt! }
  expect(dockItems([done], lead.id, {}, dismissed, T0 + MIN + 5_000)).toEqual([])
  // If continued and finished again with a newer endedAt, it shows again.
  const continued = makeThread('w1', { worker: true, status: 'finished', endedAt: T0 + 5 * MIN })
  expect(dockItems([continued], lead.id, {}, dismissed, T0 + 5 * MIN + 5_000)).toHaveLength(1)
})

test('waiting-on-Oscar and failed rows stay past 2 minutes until answered or dismissed', () => {
  // Note: on the backend a thread's turn finishes (`status: 'finished'`) after the worker sets `needs_oscar`.
  const asked = makeThread('ask1', { worker: true, status: 'finished', endedAt: T0 })
  const check = makeThread('chk1', { worker: true, status: 'finished', endedAt: T0 })
  const failed = makeThread('fail1', { worker: true, status: 'failed', failure: 'Mac mini helper is offline', endedAt: T0 })
  const longAfter = T0 + 30 * MIN
  const waiting = {
    ask1: waitingWork('ask1'),
    chk1: waitingWork('chk1', {
      question: null,
      check: { round: 1, by: { kind: 'oscar', id: null, name: 'the owner' }, state: 'checking', text: null, note: null, sameBot: false, model: null, at: T0, settledAt: null }
    })
  }
  const items = dockItems([failed, check, asked], lead.id, waiting, {}, longAfter)
  expect(items.map(i => [i.thread.id, i.kind, i.canAnswer])).toEqual([
    ['ask1', 'waiting_oscar', true],
    ['chk1', 'waiting_oscar', false],
    ['fail1', 'failed', false]
  ])
  expect(dockRowState(items[0], lead.id, longAfter)).toEqual({ icon: 'waiting', text: 'Waiting for you · Confirm empty-file behavior', failed: false, stopped: false })
  expect(dockRowState(items[1], lead.id, longAfter)).toEqual({ icon: 'waiting', text: 'Waiting for your check', failed: false, stopped: false })
  expect(dockRowState(items[2], lead.id, longAfter)).toMatchObject({ icon: 'failed', failed: true, text: 'Failed · Mac mini helper is offline' })
  expect(nextDockExpiryAt(items)).toBeNull()
  // Dismissing the failed row removes only the failed row.
  const afterDismiss = dockItems([failed, asked], lead.id, waiting, { fail1: T0 }, longAfter)
  expect(afterDismiss.map(i => i.thread.id)).toEqual(['ask1'])
})

test('explicit priority order does not depend on server order, and summaries match Frames 1-4', () => {
  const fin = makeThread('fin', { worker: true, status: 'finished', endedAt: T0 + 3 * MIN })
  const runBot = makeThread('run-bot', { participants: [lead, eng], status: 'working', createdAt: T0 + MIN })
  const runWorker = makeThread('run-w', { worker: true, status: 'working', createdAt: T0 + 2 * MIN })
  const queued = makeThread('q', { worker: true, status: 'waiting', createdAt: T0 + 3 * MIN })
  const fail = makeThread('fail', { participants: [lead, gone], status: 'failed', failure: 'Old Bot was deleted', endedAt: T0 + 2 * MIN })
  const ask = makeThread('ask', { worker: true, status: 'finished', endedAt: T0 })
  const now = T0 + 4 * MIN

  // Shuffled input order still produces waiting -> working (newest first) -> queued -> failed -> finished.
  const sorted = dockItems([fin, queued, fail, runBot, ask, runWorker], lead.id, { ask: waitingWork('ask') }, {}, now)
  expect(sorted.map(i => i.thread.id)).toEqual(['ask', 'run-w', 'run-bot', 'q', 'fail', 'fin'])
  // Deleted bot keeps its stored participant name.
  expect(dockRowTitle(sorted[4], lead.id, false)).toBe('Old Bot · Task fail')

  // Frame 1: 3 tasks · 2 running (2 running + 1 finished)
  const frame1 = dockItems([fin, runBot, runWorker], lead.id, {}, {}, now)
  expect(dockHeaderSummary(frame1)).toEqual({ icon: 'working', text: '3 tasks · 2 running' })
  expect(dockCollapsedSummary(frame1, lead.id)).toEqual({ icon: 'working', lead: '2 running', detail: '1 finished · Worker, Server Engineer' })
  // Frame 3: single running item -> "1 running"
  expect(dockHeaderSummary(dockItems([runWorker], lead.id, {}, {}, now))).toEqual({ icon: 'working', text: '1 running' })
  // Frame 3: 1 waiting + 1 failed -> "2 tasks · 1 waiting for you · 1 failed"
  const waitAndFail = dockItems([fail, ask], lead.id, { ask: waitingWork('ask') }, {}, now)
  expect(dockHeaderSummary(waitAndFail)).toEqual({ icon: 'waiting', text: '2 tasks · 1 waiting for you · 1 failed' })
})

test('batches group >=2 visible tasks with worker-only vs mixed headers and unwrap a lone survivor', () => {
  const now = T0 + 4 * MIN
  const w1 = makeThread('w1', { worker: true, batchId: 'b1', status: 'working', createdAt: T0 + 2 })
  const w2 = makeThread('w2', { worker: true, batchId: 'b1', status: 'finished', endedAt: T0 + 3 * MIN, createdAt: T0 + 3 })
  const solo = makeThread('s1', { participants: [lead, eng], batchId: 'b2', status: 'working', createdAt: T0 })
  const all = [w1, w2, solo]
  const items = dockItems(all, lead.id, {}, {}, now)
  const entries = dockEntries(items, all, lead.id)
  expect(entries).toHaveLength(2)
  expect(entries[0]).toMatchObject({ kind: 'batch', batchId: 'b1', title: 'Started 2 workers', progress: '1 of 2 finished', allWorkers: true })
  if (entries[0].kind === 'batch') {
    expect(dockRowTitle(entries[0].items[0], lead.id, entries[0].allWorkers)).toBe('Task w1')
  }
  expect(entries[1]).toMatchObject({ kind: 'single' })

  // Once w2 expires, w1 unwraps cleanly to a standalone row with its "Worker · " prefix.
  const later = T0 + 10 * MIN
  const laterEntries = dockEntries(dockItems(all, lead.id, {}, {}, later), all, lead.id)
  expect(laterEntries.every(e => e.kind === 'single')).toBe(true)

  // Mixed batch (worker + another bot) uses "Handed out 2 tasks" and keeps prefixes.
  const m1 = makeThread('m1', { worker: true, batchId: 'mix', status: 'working' })
  const m2 = makeThread('m2', { participants: [lead, eng], batchId: 'mix', status: 'working' })
  const mixed = dockEntries(dockItems([m1, m2], lead.id, {}, {}, now), [m1, m2], lead.id)
  expect(mixed[0]).toMatchObject({ kind: 'batch', title: 'Handed out 2 tasks', progress: '0 of 2 finished', allWorkers: false })

  // A worker whose exchange turn finished while its work item is `needs_oscar` is NOT counted as finished in the batch header.
  const waiting = { w2: waitingWork('w2') }
  const waitingBatch = dockEntries(dockItems([w1, w2], lead.id, waiting, {}, now), [w1, w2], lead.id, waiting)
  expect(waitingBatch[0]).toMatchObject({ kind: 'batch', title: 'Started 2 workers', progress: '0 of 2 finished', allWorkers: true })

  // Remote worker dock rows show the computer name both standalone and inside an all-worker batch.
  const rw = makeThread('rw1', { worker: true, computer: 'c1', computerName: 'Studio', status: 'working' })
  const [rwItem] = dockItems([rw], lead.id, {}, {}, now)
  expect(dockRowTitle(rwItem, lead.id, false)).toBe('Worker · Studio · Task rw1')
  expect(dockRowTitle(rwItem, lead.id, true)).toBe('Studio · Task rw1')
})
