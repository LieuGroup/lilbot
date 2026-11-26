/** Shared test fixtures and fake socket builder for iOS Work unit and store resilience tests. */
import type { WorkSocket } from '../../ios/src/work/store-core'
import type { WorkCheck } from '../../shared/work-check-schema'
import type { WorkItem, WorkSummary } from '../../shared/work-schema'

export const makeWorkCheck = (over: Partial<WorkCheck> = {}): WorkCheck => ({
  round: 1,
  by: { kind: 'bot', id: 'b2', name: 'Beta' },
  state: 'verified',
  text: 'Checked ok',
  note: null,
  sameBot: false,
  model: null,
  at: 5_000,
  settledAt: 6_000,
  ...over
})

export const makeWorkSummary = (over: Partial<WorkSummary> = {}): WorkSummary => ({
  id: 'w1',
  title: 'Ship update',
  ownerId: 'b1',
  ownerName: 'Alpha',
  askedBy: { kind: 'oscar', id: null, name: 'Oscar' },
  origin: { kind: 'conversation', id: 's1' },
  parentId: null,
  goalId: null,
  kind: 'code',
  checkLevel: 1,
  defaultLevel: 1,
  check: null,
  status: 'working',
  question: null,
  evidenceCount: 0,
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_500,
  finishedAt: null,
  ...over
})

export const makeWorkItem = (over: Partial<WorkItem> = {}): WorkItem => ({
  ...makeWorkSummary(over),
  done: 'Tests pass',
  result: '',
  dropReason: null,
  evidence: [],
  events: [],
  checks: [],
  children: [],
  links: [],
  ...over
})

export function makeFakeWorkSocket(connected: boolean, handler: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
  const workListeners = new Set<() => void>()
  const connListeners = new Set<(ok: boolean) => void>()
  const calls: Array<{ method: string; params: Record<string, unknown> }> = []
  const socket: WorkSocket = {
    connected,
    call: (async (method: string, params?: Record<string, unknown>) => {
      calls.push({ method, params: params ?? {} })
      return handler(method, params ?? {})
    }) as WorkSocket['call'],
    onWorkChanged: cb => {
      workListeners.add(cb)
      return () => workListeners.delete(cb)
    },
    onConnection: cb => {
      connListeners.add(cb)
      return () => connListeners.delete(cb)
    }
  }
  return {
    socket,
    calls,
    workListeners,
    connListeners,
    emitWork: () => {
      for (const cb of workListeners) cb()
    },
    setConnected: (next: boolean) => {
      socket.connected = next
      for (const cb of connListeners) cb(next)
    }
  }
}
