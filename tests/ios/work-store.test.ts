/** Resilience and UI-contract tests for PR 2 (`ios/src/work/`): closed-socket silence, single reconnect
 *  reload, push burst coalescing, server-switch reset/unsub, per-key sequence ordering, shared keyboard
 *  helpers, single-submit guards, and Work tab/WorkLine wiring. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createWorkStore, type WorkSocket } from '../../ios/src/work/store-core'
import type { WorkLevels } from '../../shared/work-check-schema'
import type { WorkBrief, WorkItem, WorkSummary } from '../../shared/work-schema'

const makeSummary = (id: string, title = 'Task'): WorkSummary => ({
  id,
  title,
  ownerId: 'atlas',
  ownerName: 'Atlas',
  askedBy: { kind: 'oscar', id: null, name: 'Oscar' },
  origin: { kind: 'conversation', id: 's1' },
  parentId: null,
  goalId: null,
  kind: 'code',
  checkLevel: 1,
  defaultLevel: 1,
  check: null,
  status: 'needs_oscar',
  question: 'Confirm?',
  evidenceCount: 0,
  createdAt: 1_000,
  updatedAt: 2_000,
  startedAt: 1_000,
  finishedAt: null
})

const makeItem = (id: string, title = 'Task'): WorkItem => ({
  ...makeSummary(id, title),
  done: 'Done',
  result: '',
  dropReason: null,
  evidence: [],
  events: [],
  checks: [],
  children: [],
  links: []
})

function makeFakeSocket(connected: boolean, handler: (method: string, params: Record<string, unknown>) => Promise<unknown>) {
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

describe('createWorkStore resilience: closed socket, reconnect, bursts, server switch, and ordering', () => {
  test('makes zero RPCs on a closed socket, writes no errors, and reloads once on reconnect', async () => {
    const fake = makeFakeSocket(false, async method => {
      if (method === 'work.brief') return { since: 0, needsOscar: [makeSummary('w1')], failed: [], done: { count: 0, items: [] } } satisfies WorkBrief
      if (method === 'work.open') return makeItem('w1')
      if (method === 'work.levels.get') return { kinds: [] } satisfies WorkLevels
      return [makeSummary('w1')]
    })
    const mgr = createWorkStore(() => fake.socket, { pushCoalesceMs: 15 })
    const offs = [mgr.watchBadge(), mgr.watchBrief(), mgr.watchItem('w1')]
    await Bun.sleep(20)
    expect(fake.calls).toHaveLength(0)
    expect(mgr.useStore.getState().briefError).toBe('')
    expect(mgr.useStore.getState().itemErrors.w1).toBeUndefined()

    fake.setConnected(true)
    await Bun.sleep(20)
    expect(fake.calls.filter(c => c.method === 'work.brief')).toHaveLength(1)
    expect(fake.calls.filter(c => c.method === 'work.open')).toHaveLength(1)
    expect(mgr.useStore.getState().badgeCount).toBe(1)
    expect(mgr.useStore.getState().items.w1?.id).toBe('w1')
    for (const off of offs) off()
  })

  test('coalesces push bursts and cancels pending timers on disconnect', async () => {
    const fake = makeFakeSocket(true, async () => [makeSummary('w1')])
    const mgr = createWorkStore(() => fake.socket, { pushCoalesceMs: 25 })
    const stop = mgr.watchBadge()
    await Bun.sleep(10)
    const initialCalls = fake.calls.length

    for (let i = 0; i < 6; i++) fake.emitWork()
    await Bun.sleep(45)
    expect(fake.calls.length - initialCalls).toBe(1)

    const beforeDisconnect = fake.calls.length
    fake.emitWork()
    fake.setConnected(false)
    await Bun.sleep(45)
    expect(fake.calls.length).toBe(beforeDisconnect)
    stop()
  })

  test('resets prior-server state, unsubscribes old socket listeners, and drops out-of-order replies', async () => {
    let resolveSlow!: (item: WorkItem) => void
    let callIdx = 0
    const s1 = makeFakeSocket(true, async (method, params) => {
      if (method === 'work.open' && params.itemId === 'w1') {
        callIdx++
        return callIdx === 1
          ? new Promise<WorkItem>(r => {
              resolveSlow = r
            })
          : makeItem('w1', 'Fresh title')
      }
      return [makeSummary('w1')]
    })
    const s2 = makeFakeSocket(true, async method => (method === 'work.open' ? makeItem('w1', 'Server 2 title') : []))
    let active: WorkSocket = s1.socket
    const mgr = createWorkStore(() => active, { pushCoalesceMs: 10 })
    const offs = [mgr.watchBadge(), mgr.watchItem('w1')]
    await Bun.sleep(10)

    await mgr.loadItem('w1')
    expect(mgr.useStore.getState().items.w1?.title).toBe('Fresh title')
    resolveSlow(makeItem('w1', 'Stale title'))
    await Bun.sleep(10)
    expect(mgr.useStore.getState().items.w1?.title).toBe('Fresh title')

    active = s2.socket
    mgr.syncSocket()
    expect(s1.workListeners.size).toBe(0)
    expect(s1.connListeners.size).toBe(0)
    await Bun.sleep(15)
    expect(mgr.useStore.getState().badgeCount).toBe(0)
    expect(mgr.useStore.getState().items.w1?.title).toBe('Server 2 title')
    for (const off of offs) off()
  })
})

describe('PR 2 keyboard, single-submit, native badge, and route wiring contracts', () => {
  test('wires shared keyboard helpers, single-submit locks, native Work tab badge, and WorkLine', () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
    const storeSrc = read('ios/src/work/store.ts')
    const dropSrc = read('ios/src/work/drop-work-sheet.tsx')
    const addSrc = read('ios/src/work/add-bot-level-sheet.tsx')
    const todaySrc = read('ios/src/work/work-today-page.tsx')
    const itemSrc = read('ios/src/work/work-item-page.tsx')
    const actionsSrc = read('ios/src/work/work-item-actions.tsx')
    const needsSrc = read('ios/src/work/needs-you-card.tsx')
    const tabsSrc = read('ios/src/app/(tabs)/_layout.tsx')
    const chatSrc = read('ios/src/app/(tabs)/(bots)/chat.tsx')
    const indexSrc = read('ios/src/app/(tabs)/(bots)/index.tsx')

    expect(storeSrc).not.toContain('state.connected')
    expect(storeSrc).toContain('manager.syncSocket()')
    expect(dropSrc).toContain("from '../ui/use-keyboard-height'")
    expect(dropSrc).toContain('useKeyboardHeight(true)')
    expect(dropSrc).toContain('{...KEYBOARD_SCROLL_PROPS}')
    expect(dropSrc).toContain('sheetKeyboardInset(')
    expect(dropSrc).toContain('allowSwipeDismissal={!busy}')
    expect(dropSrc).toContain('if (busyRef.current) return')
    expect(dropSrc).toContain('testID="drop-keyboard-done"')
    expect(dropSrc.indexOf('</ScrollView>')).toBeLessThan(dropSrc.indexOf('testID="drop-work-footer"'))
    expect(addSrc).toContain('allowSwipeDismissal={!busy}')
    expect(addSrc).toContain('Keyboard.dismiss()')
    expect(todaySrc).toContain('{...KEYBOARD_SCROLL_PROPS}')
    expect(todaySrc).toContain('sheetScrollBottomPadding(')
    expect(itemSrc).toContain('{...KEYBOARD_SCROLL_PROPS}')
    expect(itemSrc).toContain('sheetScrollBottomPadding(')
    expect(actionsSrc).toContain('busyRef.current')
    expect(actionsSrc).toContain('sendingRef.current')
    expect(needsSrc).toContain('sendingRef.current')
    expect(tabsSrc).toContain('<NativeTabs.Trigger name="(work)">')
    expect(tabsSrc).toContain('NativeTabs.Trigger.Badge')
    expect(tabsSrc).toContain('workTabBadge(useNeedsYouCount())')
    expect(chatSrc).toContain('withWorkToolRenderer(')
    expect(indexSrc).toContain('withWorkToolRenderer(')
  })
})
