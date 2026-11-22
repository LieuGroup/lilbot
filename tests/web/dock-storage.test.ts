import { afterEach, expect, test } from 'bun:test'
import type { WorkSummary } from '../../shared/work-schema'
import {
  COLLAPSED_PREFIX,
  DISMISSED_PREFIX,
  pruneDismissed,
  readCollapsed,
  readDismissed,
  selectWaitingWork,
  watchDockStorage,
  writeCollapsed,
  writeDismissed
} from '../../web/src/threads/dock-storage'

const originalStorage = globalThis.localStorage
const originalWindow = globalThis.window

afterEach(() => {
  Object.defineProperty(globalThis, 'localStorage', { value: originalStorage, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'window', { value: originalWindow, configurable: true, writable: true })
})

function mockStorage() {
  const data = new Map<string, string>()
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear()
  }
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true })
  return { data, storage }
}

function workItem(id: string, exchangeId: string, extra: Partial<WorkSummary> = {}): WorkSummary {
  return {
    id,
    title: `Work ${id}`,
    ownerId: 'lead',
    ownerName: 'FillLight Bot',
    askedBy: { kind: 'self', id: 'lead', name: 'FillLight Bot' },
    origin: { kind: 'exchange', id: exchangeId },
    parentId: null,
    goalId: null,
    kind: 'code',
    checkLevel: 1,
    defaultLevel: 1,
    check: null,
    status: 'needs_oscar',
    question: `Question ${id}`,
    evidenceCount: 0,
    createdAt: 1000,
    updatedAt: 1000,
    startedAt: 1000,
    finishedAt: null,
    ...extra
  }
}

test('dismissed and collapsed dock state persist per bot in localStorage, stay bounded, and sync across tabs', () => {
  mockStorage()
  expect(readDismissed('bot-a')).toEqual({})
  expect(readCollapsed('bot-a')).toBe(false)

  writeCollapsed('bot-a', true)
  expect(readCollapsed('bot-a')).toBe(true)
  expect(readCollapsed('bot-b')).toBe(false)

  const saved = writeDismissed('bot-a', { 'fail-1': 5000 })
  expect(saved).toEqual({ 'fail-1': 5000 })
  // Stable object identity across reads while unchanged (safe for React useSyncExternalStore).
  expect(readDismissed('bot-a')).toBe(readDismissed('bot-a'))
  expect(readDismissed('bot-b')).toEqual({})

  // Caps stored dismissals to the 200 newest entries.
  const many: Record<string, number> = {}
  for (let i = 0; i < 250; i++) many[`t-${i}`] = i + 1
  const pruned = pruneDismissed(many)
  expect(Object.keys(pruned)).toHaveLength(200)
  expect(pruned['t-249']).toBe(250)
  expect(pruned['t-0']).toBeUndefined()

  // Cross-tab storage events update listeners for dismissals, collapse, and clear.
  const listeners = new Set<(ev: StorageEvent) => void>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      addEventListener: (_type: string, fn: (ev: StorageEvent) => void) => listeners.add(fn),
      removeEventListener: (_type: string, fn: (ev: StorageEvent) => void) => listeners.delete(fn)
    },
    configurable: true,
    writable: true
  })
  const events: unknown[] = []
  const stop = watchDockStorage({
    onCollapsed: (botId, collapsed) => events.push(['collapsed', botId, collapsed]),
    onDismissed: (botId, map) => events.push(['dismissed', botId, map]),
    onClear: () => events.push(['clear'])
  })
  for (const fn of listeners) {
    fn({ key: `${DISMISSED_PREFIX}bot-a`, newValue: JSON.stringify({ 'fail-2': 9000 }) } as StorageEvent)
    fn({ key: `${COLLAPSED_PREFIX}bot-b`, newValue: 'collapsed' } as StorageEvent)
    fn({ key: null, newValue: null } as StorageEvent)
  }
  stop()
  expect(events).toEqual([['dismissed', 'bot-a', { 'fail-2': 9000 }], ['collapsed', 'bot-b', true], ['clear']])
})

test('selectWaitingWork prefers the exchange primary item, and prefers an answerable question over an open Oscar check', () => {
  const oscarCheck = {
    round: 1,
    by: { kind: 'oscar' as const, id: null, name: 'Oscar' },
    state: 'checking' as const,
    text: null,
    note: null,
    sameBot: false,
    model: null,
    at: 1000,
    settledAt: null
  }
  // Primary item beats a newer secondary question even when secondary comes later in list order.
  const primary = workItem('ex-1', 'ex-1', { updatedAt: 1000 })
  const secondaryLater = workItem('sec-1', 'ex-1', { updatedAt: 9000 })
  expect(selectWaitingWork([primary, secondaryLater])['ex-1'].id).toBe('ex-1')
  expect(selectWaitingWork([secondaryLater, primary])['ex-1'].id).toBe('ex-1')

  // Primary open Oscar check still beats a secondary item for the same exchange.
  const primaryCheck = workItem('ex-2', 'ex-2', { question: null, check: oscarCheck, updatedAt: 1000 })
  const secQuestion = workItem('sec-2', 'ex-2', { updatedAt: 9000 })
  expect(selectWaitingWork([primaryCheck, secQuestion])['ex-2'].id).toBe('ex-2')

  // Among secondary items on an exchange, an answerable question beats an open Oscar check regardless of list order.
  const secQ = workItem('sec-q', 'ex-3', { updatedAt: 1000 })
  const secCheck = workItem('sec-c', 'ex-3', { question: null, check: oscarCheck, updatedAt: 9000 })
  expect(selectWaitingWork([secQ, secCheck])['ex-3'].id).toBe('sec-q')
  expect(selectWaitingWork([secCheck, secQ])['ex-3'].id).toBe('sec-q')
})
