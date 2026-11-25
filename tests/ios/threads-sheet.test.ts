/** Unit tests for pageSheet keyboard inset math, bounded answer input height, single-send locks,
 *  shared keyboard helper reuse, store hook dependencies, answered-elsewhere notices, and 44 pt touch targets. */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { answerInputMaxHeight, sheetKeyboardInset } from '../../ios/src/threads/sheet-keyboard'

describe('pageSheet keyboard inset and bounded answer input geometry', () => {
  test('computes exact inset on Folded Duo, iPhone, centered iPad pageSheet, and mid-slide fallback', () => {
    expect(sheetKeyboardInset(678, 0)).toBe(0)
    expect(sheetKeyboardInset(678, 318, { y: 24, height: 654 })).toBe(318)
    expect(sheetKeyboardInset(678, 318, { y: 678, height: 654 })).toBe(318)
    expect(sheetKeyboardInset(1024, 324, { y: 140, height: 744 })).toBe(184)
    expect(sheetKeyboardInset(1024, 100, { y: 140, height: 744 })).toBe(0)
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

describe('PR #303 sheet single-send, keyboard, store hook, and 44 pt touch target contracts', () => {
  test('uses shared ui/use-keyboard-height, pins footer, enforces single-send locks, store hook deps, and 44 pt hit targets', () => {
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
    const answerSrc = read('ios/src/threads/answer-work-sheet.tsx')
    const stopSrc = read('ios/src/threads/stop-thread-sheet.tsx')
    const storeSrc = read('ios/src/threads/store.ts')
    const dockSrc = read('ios/src/threads/task-dock.tsx')
    const pillSrc = read('ios/src/threads/task-dock-pill.tsx')
    const lineSrc = read('ios/src/threads/thread-line.tsx')

    expect(answerSrc).toContain("from '../ui/use-keyboard-height'")
    expect(answerSrc).toContain('useKeyboardHeight(true)')
    expect(answerSrc).toContain('{...KEYBOARD_SCROLL_PROPS}')
    expect(answerSrc).toContain('allowSwipeDismissal={!busy}')
    expect(answerSrc).toContain('if (busyRef.current) return')
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
