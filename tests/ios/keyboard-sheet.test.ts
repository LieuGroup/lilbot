import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { computePopoverSheetLayout, keyboardOverlapHeight, selectionScrollOffset, sheetScrollBottomPadding, shouldBackdropDismissKeyboard } from '../../ios/src/ui/keyboard-sheet'

const IOS_SRC = join(import.meta.dir, '../../ios/src')

describe('keyboardOverlapHeight', () => {
  test('computes exact bottom overlap from windowHeight and screenY', () => {
    expect(keyboardOverlapHeight(678, { height: 310, screenY: 368 })).toBe(310)
    expect(keyboardOverlapHeight(852, { height: 336, screenY: 516 })).toBe(336)
    expect(keyboardOverlapHeight(768, { height: 55, screenY: 713 })).toBe(55)
  })

  test('returns 0 when keyboard is hidden, off-screen, or invalid', () => {
    expect(keyboardOverlapHeight(678, { height: 310, screenY: 678 })).toBe(0)
    expect(keyboardOverlapHeight(678, { height: 310, screenY: 700 })).toBe(0)
    expect(keyboardOverlapHeight(678, { height: 0, screenY: 678 })).toBe(0)
    expect(keyboardOverlapHeight(678, undefined)).toBe(0)
  })

  test('falls back to height when screenY is omitted', () => {
    expect(keyboardOverlapHeight(678, { height: 291 })).toBe(291)
  })
})

describe('computePopoverSheetLayout', () => {
  test('Folded Duo (466x678, 382pt pane) caps maxHeight at rest and lifts completely above keyboard', () => {
    const rest = computePopoverSheetLayout({
      containerHeight: 678,
      containerWidth: 382,
      topInset: 0,
      bottomInset: 34,
      keyboardHeight: 0,
      surface: 'duo-folded'
    })
    expect(rest.liftedAboveKeyboard).toBe(false)
    expect(rest.bottom).toBe(50)
    expect(rest.maxHeight).toBeLessThanOrEqual(440)
    expect(rest.bottom + rest.maxHeight).toBeLessThan(678)
    expect(rest.maxWidth).toBe(350)

    const withKeyboard = computePopoverSheetLayout({
      containerHeight: 678,
      containerWidth: 382,
      topInset: 0,
      bottomInset: 34,
      keyboardHeight: 310,
      surface: 'duo-folded'
    })
    expect(withKeyboard.liftedAboveKeyboard).toBe(true)
    expect(withKeyboard.bottom).toBe(318)
    expect(withKeyboard.bottom).toBeGreaterThan(310)
    expect(withKeyboard.maxHeight).toBe(348)
    expect(withKeyboard.bottom + withKeyboard.maxHeight).toBeLessThanOrEqual(678 - 12)
  })

  test('ordinary iPhone, Unfolded Duo, and iPad keep sheet above keyboard and cap width on wide panes', () => {
    const phone = computePopoverSheetLayout({
      containerHeight: 752,
      containerWidth: 393,
      topInset: 0,
      bottomInset: 34,
      keyboardHeight: 336,
      surface: 'phone'
    })
    expect(phone.liftedAboveKeyboard).toBe(true)
    expect(phone.bottom).toBe(344)
    expect(phone.maxHeight).toBe(396)

    const unfoldedLandscape = computePopoverSheetLayout({
      containerHeight: 669,
      containerWidth: 603,
      topInset: 0,
      bottomInset: 20,
      keyboardHeight: 310,
      surface: 'duo-unfolded-landscape'
    })
    expect(unfoldedLandscape.liftedAboveKeyboard).toBe(true)
    expect(unfoldedLandscape.maxWidth).toBe(420)
    expect(unfoldedLandscape.maxHeight).toBe(339)

    const ipad = computePopoverSheetLayout({
      containerHeight: 768,
      containerWidth: 760,
      topInset: 24,
      bottomInset: 20,
      keyboardHeight: 320,
      surface: 'pad'
    })
    expect(ipad.liftedAboveKeyboard).toBe(true)
    expect(ipad.maxWidth).toBe(420)
    expect(ipad.bottom + ipad.maxHeight).toBeLessThanOrEqual(768 - 32)
  })

  test('extreme cramped viewport falls back to scrollBottomInset so last option clears keyboard', () => {
    const cramped = computePopoverSheetLayout({
      containerHeight: 520,
      containerWidth: 382,
      topInset: 0,
      bottomInset: 34,
      keyboardHeight: 360,
      surface: 'duo-folded'
    })
    expect(cramped.liftedAboveKeyboard).toBe(false)
    expect(cramped.scrollBottomInset).toBeGreaterThan(300)
    expect(cramped.scrollIndicatorBottomInset).toBeGreaterThan(300)
    expect(cramped.bottom + cramped.scrollBottomInset).toBeGreaterThan(360)
  })
})

describe('selectionScrollOffset and sheetScrollBottomPadding', () => {
  test('keeps top items at 0 and scrolls deep active selection into upper third of viewport', () => {
    expect(selectionScrollOffset(24, 38, 300)).toBe(0)
    expect(selectionScrollOffset(240, 38, 300)).toBe(0)
    expect(selectionScrollOffset(480, 38, 300)).toBe(390)
    expect(selectionScrollOffset(480, 38, 0)).toBe(0)
  })

  test('adds keyboard height to form/list bottom padding and tracks backdrop dismiss state', () => {
    expect(sheetScrollBottomPadding(28, 0)).toBe(28)
    expect(sheetScrollBottomPadding(28, 0, 34)).toBe(50)
    expect(sheetScrollBottomPadding(28, 310)).toBe(354)
    expect(shouldBackdropDismissKeyboard(0, false)).toBe(false)
    expect(shouldBackdropDismissKeyboard(310, false)).toBe(true)
    expect(shouldBackdropDismissKeyboard(0, true)).toBe(true)
  })
})

describe('audited iOS sheets & forms keyboard contract', () => {
  test('ModelMenu opens without autoFocus, dismisses keyboard on open, and supports drag + tap-outside + Done', () => {
    const menu = readFileSync(join(IOS_SRC, 'bots/model-menu.tsx'), 'utf8')
    expect(menu).not.toContain('autoFocus')
    expect(menu).toContain('Keyboard.dismiss()')
    expect(menu).toContain('KEYBOARD_SCROLL_PROPS')
    expect(menu).toContain('returnKeyType="done"')
    expect(menu).toContain('submitBehavior="blurAndSubmit"')
    expect(menu).toContain('shouldBackdropDismissKeyboard')
    expect(menu).toContain('selectionScrollOffset')
  })

  test('all audited TextInput sheets and search lists apply keyboard inset and drag/handled scroll props', () => {
    const audited = ['bots/roster.tsx', 'bots/edit-avatar-sheet.tsx', 'bots/new-bot-sheet.tsx', 'bots/section-sheet.tsx', 'settings/screen.tsx']
    for (const rel of audited) {
      const src = readFileSync(join(IOS_SRC, rel), 'utf8')
      expect(src).toContain('useKeyboardHeight')
      expect(src.includes('KEYBOARD_SCROLL_PROPS') || (src.includes('keyboardDismissMode="on-drag"') && src.includes('keyboardShouldPersistTaps="handled"'))).toBe(true)
      expect(src).toContain('sheetScrollBottomPadding')
    }
    const rosterChrome = readFileSync(join(IOS_SRC, 'bots/roster-chrome.tsx'), 'utf8')
    expect(rosterChrome).toContain('returnKeyType="search"')
    expect(rosterChrome).toContain('submitBehavior="blurAndSubmit"')
  })
})
