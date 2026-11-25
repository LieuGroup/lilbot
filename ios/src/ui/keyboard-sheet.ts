/** Pure keyboard-aware sheet and scroll-inset layout rules shared across popovers and modal forms.
 *  Zero React Native imports so unit tests verify Folded Duo, iPhone, Unfolded Duo, iPad, and AX5 on Linux. */
import type { SurfaceKind } from '../duo/layout'

export interface KeyboardCoordinates {
  height: number
  screenY?: number
}

export interface PopoverSheetInput {
  containerHeight: number
  containerWidth: number
  topInset: number
  bottomInset: number
  keyboardHeight: number
  surface: SurfaceKind
  preferredMaxHeight?: number
}

export interface PopoverSheetLayout {
  bottom: number
  maxHeight: number
  maxWidth: number
  scrollBottomInset: number
  scrollIndicatorBottomInset: number
  liftedAboveKeyboard: boolean
}

const DEFAULT_MAX_HEIGHT = 460
const COMPACT_HEIGHT_THRESHOLD = 700
const COMPACT_MAX_HEIGHT = 440
const MAX_POPOVER_WIDTH = 420
const MIN_POPOVER_WIDTH = 240
const HORIZONTAL_MARGIN = 16
const KEYBOARD_GAP = 8
const MIN_LIFTED_SHEET_HEIGHT = 180

/** Exact vertical overlap of the software keyboard (or hardware shortcut bar) with the bottom of the window. */
export function keyboardOverlapHeight(windowHeight: number, coords: KeyboardCoordinates | null | undefined): number {
  if (!coords || !Number.isFinite(coords.height) || coords.height <= 0) return 0
  if (Number.isFinite(windowHeight) && windowHeight > 0 && typeof coords.screenY === 'number' && Number.isFinite(coords.screenY)) {
    const overlap = windowHeight - coords.screenY
    return overlap > 0 ? Math.round(Math.min(overlap, coords.height)) : 0
  }
  return Math.round(coords.height)
}

/** Computes a popover sheet's position, capped height, and scroll inset so no option is trapped under the keyboard.
 *  - Keyboard down: caps height cleanly on short Folded Duo screens while leaving backdrop above to tap.
 *  - Keyboard up: lifts the sheet above the keyboard whenever >= 180 pt remain above it; on extreme cramped
 *    viewports, keeps full height and adds bottom scroll inset so the last option still scrolls above the keyboard. */
export function computePopoverSheetLayout(input: PopoverSheetInput): PopoverSheetLayout {
  const containerHeight = Math.max(0, Math.round(input.containerHeight))
  const containerWidth = Math.max(0, Math.round(input.containerWidth))
  const topInset = Math.max(0, Math.round(input.topInset))
  const bottomInset = Math.max(0, Math.round(input.bottomInset))
  const keyboardHeight = Math.max(0, Math.round(input.keyboardHeight))

  const topMargin = Math.max(12, topInset + 8)
  const restBottom = Math.max(bottomInset + 16, 48)
  const isShortScreen = input.surface === 'duo-folded' || containerHeight <= COMPACT_HEIGHT_THRESHOLD
  const heightCap = input.preferredMaxHeight ?? (isShortScreen ? COMPACT_MAX_HEIGHT : DEFAULT_MAX_HEIGHT)
  const maxWidth = Math.min(MAX_POPOVER_WIDTH, Math.max(MIN_POPOVER_WIDTH, containerWidth - HORIZONTAL_MARGIN * 2))

  if (containerHeight === 0) {
    return {
      bottom: keyboardHeight > 0 ? keyboardHeight + KEYBOARD_GAP : restBottom,
      maxHeight: heightCap,
      maxWidth,
      scrollBottomInset: 8,
      scrollIndicatorBottomInset: 0,
      liftedAboveKeyboard: keyboardHeight > 0
    }
  }

  const restAvailable = Math.max(MIN_LIFTED_SHEET_HEIGHT, containerHeight - topMargin - restBottom)
  const restMaxHeight = Math.min(heightCap, Math.floor(restAvailable * 0.85))

  if (keyboardHeight > 0) {
    const liftedBottom = keyboardHeight + KEYBOARD_GAP
    const availableAbove = containerHeight - topMargin - liftedBottom
    if (availableAbove >= MIN_LIFTED_SHEET_HEIGHT) {
      return {
        bottom: liftedBottom,
        maxHeight: Math.min(heightCap, availableAbove),
        maxWidth,
        scrollBottomInset: 8,
        scrollIndicatorBottomInset: 0,
        liftedAboveKeyboard: true
      }
    }
    const crampedBottom = Math.max(bottomInset + 8, 12)
    const crampedMaxHeight = Math.max(MIN_LIFTED_SHEET_HEIGHT, containerHeight - topMargin - crampedBottom)
    const hiddenByKeyboard = Math.max(0, keyboardHeight - crampedBottom)
    return {
      bottom: crampedBottom,
      maxHeight: Math.min(heightCap, crampedMaxHeight),
      maxWidth,
      scrollBottomInset: hiddenByKeyboard + 20,
      scrollIndicatorBottomInset: hiddenByKeyboard,
      liftedAboveKeyboard: false
    }
  }

  return {
    bottom: restBottom,
    maxHeight: Math.max(MIN_LIFTED_SHEET_HEIGHT, restMaxHeight),
    maxWidth,
    scrollBottomInset: 8,
    scrollIndicatorBottomInset: 0,
    liftedAboveKeyboard: false
  }
}

/** Bottom padding for ScrollView/FlatList forms and search lists so the last row/button clears the keyboard. */
export function sheetScrollBottomPadding(basePadding: number, keyboardHeight: number, bottomInset = 0): number {
  const safeBase = Math.max(basePadding, bottomInset + 16)
  return Math.max(0, Math.round(keyboardHeight)) > 0 ? Math.round(basePadding + keyboardHeight + 16) : Math.round(safeBase)
}

/** Scroll offset that brings the active item into view near the upper third of the scroll viewport on open. */
export function selectionScrollOffset(itemY: number, itemHeight: number, viewportHeight: number): number {
  if (!Number.isFinite(itemY) || !Number.isFinite(viewportHeight) || viewportHeight <= 0) return 0
  if (itemY + Math.max(0, itemHeight) <= viewportHeight - 12) return 0
  const target = itemY - Math.round(viewportHeight * 0.3)
  return Math.max(0, Math.round(target))
}

/** Tapping outside a popover field drops the keyboard first while search is active, and closes once down. */
export function shouldBackdropDismissKeyboard(keyboardHeight: number, searchFocused: boolean): boolean {
  return keyboardHeight > 0 || searchFocused
}
