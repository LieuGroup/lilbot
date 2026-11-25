/** Behavioral tests for Work action guards, stale/reconnect draft preservation, landscape keyboard metrics,
 *  and route/UI invariants (MOBILE_SCALE.work, zero nested modals, Duo strip & floating tab-bar hiding). */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { shouldHideNativeTabBar } from '../../ios/src/duo/stack-sync'
import { isConnectionLostError, isDroppableItem, mergeTodayNeedsItems, resolveWorkItemActionState, runSingleSubmit, staleItemNotice } from '../../ios/src/work/action-state'
import { dropSheetMetrics, WORK_TYPE_CAPS, workScrollBottomPadding } from '../../ios/src/work/board-state'
import { makeWorkItem, makeWorkSummary } from './work-fixtures'

describe('Work single-submit guard, stale draft preservation, and reconnect wording', () => {
  test('runSingleSubmit blocks concurrent double-submits and releases on resolve and reject', async () => {
    const lock = { current: false }
    let calls = 0
    let finish!: () => void
    const first = runSingleSubmit(lock, async () => {
      calls++
      await new Promise<void>(r => {
        finish = r
      })
      return 'ok'
    })
    const duplicate = await runSingleSubmit(lock, async () => {
      calls++
      return 'dup'
    })
    expect(duplicate).toEqual({ ran: false })
    expect(calls).toBe(1)
    finish()
    expect(await first).toEqual({ ran: true, value: 'ok' })
    expect(lock.current).toBe(false)

    await expect(
      runSingleSubmit(lock, async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')
    expect(lock.current).toBe(false)
  })

  test('mergeTodayNeedsItems keeps stale typed drafts and reconnect losses visible after external change', () => {
    const liveA = makeWorkSummary({ id: 'a', status: 'needs_oscar', question: 'Confirm?' })
    const staleB = makeWorkSummary({ id: 'b', status: 'needs_oscar', title: 'Answered elsewhere' })
    const merged = mergeTodayNeedsItems([liveA], {
      b: { item: staleB, draft: 'My unsent answer', lostOnDisconnect: false },
      c: { item: makeWorkSummary({ id: 'c', status: 'needs_oscar' }), draft: '   ', lostOnDisconnect: false },
      d: { item: makeWorkSummary({ id: 'd', status: 'needs_oscar' }), draft: '', lostOnDisconnect: true }
    })
    expect(merged.map(r => `${r.item.id}:${r.live}:${r.lostOnDisconnect}`)).toEqual(['a:true:false', 'b:false:false', 'd:false:true'])
  })

  test('staleItemNotice and resolveWorkItemActionState explain external changes and reconnect outcomes plainly', () => {
    expect(isConnectionLostError('The connection to LilBot was lost.')).toBe(true)
    expect(isConnectionLostError('Not connected to LilBot.')).toBe(true)
    expect(isConnectionLostError('Validation failed')).toBe(false)
    expect(isDroppableItem(makeWorkItem({ status: 'working' }))).toBe(true)
    expect(isDroppableItem(makeWorkItem({ status: 'done' }))).toBe(false)
    expect(isDroppableItem(makeWorkItem({ status: 'dropped' }))).toBe(false)

    expect(staleItemNotice('question', true)).toBeNull()
    expect(staleItemNotice('question', false)).toContain('Your draft is still here')
    expect(staleItemNotice('question', true, { afterReconnect: true })).toContain('did not land')
    expect(staleItemNotice('question', false, { afterReconnect: true })).toContain('already answered')
    expect(staleItemNotice('check', true, { afterReconnect: true })).toContain('did not land')
    expect(staleItemNotice('check', false, { afterReconnect: true })).toContain('already settled')
    expect(staleItemNotice('drop', true, { afterReconnect: true })).toContain('did not land')
    expect(staleItemNotice('drop', false, { afterReconnect: true })).toContain('already finished or dropped')

    const settled = makeWorkItem({ status: 'working' })
    const keptQuestion = resolveWorkItemActionState(settled, { questionDraft: 'Use us-west', sendBackDraft: '', sendBackOpen: false, lostKind: null, reconnected: false })
    expect(keptQuestion.showQuestion).toBe(true)
    expect(keptQuestion.notice).toContain('Your draft is still here')

    const keptAfterReconnect = resolveWorkItemActionState(settled, { questionDraft: '', sendBackDraft: 'Fix tests', sendBackOpen: true, lostKind: 'check', reconnected: true })
    expect(keptAfterReconnect.showCheck).toBe(true)
    expect(keptAfterReconnect.notice).toContain('already settled')
  })

  test('landscape drop sheet and scroll bottom padding stay compact and clear above keyboard and floating tab bar', () => {
    const land = dropSheetMetrics({ sheetHeight: 380, keyboardOverlap: 205, viewportHeight: 72 })
    expect(land.compactLandscape).toBe(true)
    expect(land.minInputHeight).toBe(44)
    expect(land.maxInputHeight).toBeLessThanOrEqual(84)

    const port = dropSheetMetrics({ sheetHeight: 678, keyboardOverlap: 260, viewportHeight: 220 })
    expect(port.compactLandscape).toBe(false)
    expect(port.minInputHeight).toBe(68)

    expect(workScrollBottomPadding({ safeBottom: 34, keyboardHeight: 0, hasFloatingTabBar: true })).toBe(110)
    expect(workScrollBottomPadding({ safeBottom: 34, keyboardHeight: 0, hasFloatingTabBar: false })).toBe(58)
    expect(workScrollBottomPadding({ safeBottom: 0, keyboardHeight: 210, hasFloatingTabBar: true })).toBe(286)
    expect(WORK_TYPE_CAPS.pageTitle).toBeLessThanOrEqual(1.4)
    expect(shouldHideNativeTabBar('phone', true)).toBe(true)
    expect(shouldHideNativeTabBar('duo-folded', true)).toBe(false)
  })
})

describe('PR #309 Round 2 route, keyboard, scale, and single-modal invariants', () => {
  test('wires keyed split WorkItemPage, zero nested modals in AddBotLevelSheet, MOBILE_SCALE.work, and Duo strip', () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
    const workIndex = read('ios/src/app/(tabs)/(work)/index.tsx')
    const workItem = read('ios/src/app/(tabs)/(work)/item.tsx')
    const tabsLayout = read('ios/src/app/(tabs)/_layout.tsx')
    const botsIndex = read('ios/src/app/(tabs)/(bots)/index.tsx')
    const addSheet = read('ios/src/work/add-bot-level-sheet.tsx')
    const controls = read('ios/src/work/work-controls.tsx')
    const today = read('ios/src/work/work-today-page.tsx')
    const itemPage = read('ios/src/work/work-item-page.tsx')

    expect(workIndex).toContain('key={selectedItemId}')
    expect(workIndex).toContain('duoVerticalHeaderOptions(')
    expect(workItem).toContain('duoVerticalHeaderOptions(')
    expect(workItem).toContain('focusWorkItem()')
    expect(workItem).toContain("router.navigate('/(tabs)/(bots)')")
    expect(tabsLayout).toContain('chatFocused || workItemFocused')
    expect(botsIndex).toContain("pathname: '/(tabs)/(work)'")
    expect(addSheet).not.toContain('OptionPickerSheet')
    expect(controls).toContain('MOBILE_SCALE.work.input')
    expect(controls).not.toContain('fontSize: 15')
    expect(today).toContain('WorkKeyboardDoneBar')
    expect(today).toContain('contentInsetAdjustmentBehavior="automatic"')
    expect(itemPage).toContain('WorkKeyboardDoneBar')
    expect(itemPage).toContain('contentInsetAdjustmentBehavior="automatic"')
  })
})
