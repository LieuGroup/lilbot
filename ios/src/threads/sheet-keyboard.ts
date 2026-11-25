/** Pure pageSheet keyboard inset & bounded multiline input height helpers for `AnswerWorkSheet`.
 *  Builds directly on the shared `useKeyboardHeight` value from `ios/src/ui/use-keyboard-height.ts`. */

export interface SheetWindowFrame {
  y: number
  height: number
}

export interface AnswerInputLayoutInput {
  viewportHeight?: number
  sheetHeight: number
  keyboardOverlap: number
  fontScale: number
  hasError?: boolean
  hasNotice?: boolean
}

/** Converts window-level `keyboardHeight` (from `useKeyboardHeight`) into the exact bottom overlap inside
 *  a Modal pageSheet: keeps single and stacked bottom-anchored phone/Duo sheets exact (never subtracting a
 *  small apparent gap when UIKit shortens a nested sheet's height), adds any positive bottom overhang, and
 *  trims real bottom gaps only on centered iPad pageSheets (`y >= 40` and bottom gap `>= 40`). */
export function sheetKeyboardInset(windowHeight: number, keyboardHeight: number, sheetFrame?: SheetWindowFrame | null): number {
  const kb = Math.max(0, Math.round(keyboardHeight))
  if (kb === 0) return 0
  const sheetBottom = sheetFrame ? sheetFrame.y + sheetFrame.height : Number.NaN
  const validFrame =
    sheetFrame &&
    Number.isFinite(windowHeight) &&
    windowHeight > 0 &&
    Number.isFinite(sheetFrame.y) &&
    Number.isFinite(sheetFrame.height) &&
    sheetFrame.height > 100 &&
    sheetFrame.y >= 0 &&
    sheetFrame.y < windowHeight * 0.5 &&
    sheetBottom <= windowHeight + 48
  if (!validFrame) return kb
  if (sheetBottom > windowHeight) return Math.max(0, Math.round(kb + (sheetBottom - windowHeight)))
  const gapBelowSheet = Math.round(windowHeight - sheetBottom)
  if (sheetFrame.y >= 40 && gapBelowSheet >= 40) return Math.max(0, kb - gapBelowSheet)
  return kb
}

/** Caps multiline answer TextInput height to the measured ScrollView viewport so a 10-line answer scrolls
 *  inside the input while its bottom border, active line, caret, and any error stay visible above the pinned footer. */
export function answerInputMaxHeight(input: AnswerInputLayoutInput): number {
  const fallbackViewport = Math.max(0, input.sheetHeight - input.keyboardOverlap - (input.fontScale >= 1.5 ? 132 : 118))
  const viewport = input.viewportHeight && input.viewportHeight > 0 ? input.viewportHeight : fallbackViewport
  if (input.keyboardOverlap > 0) {
    const errorReserve = input.hasError ? (input.fontScale >= 1.5 ? 78 : 60) : 24
    const noticeReserve = input.hasNotice ? (input.fontScale >= 1.5 ? 46 : 36) : 0
    return Math.max(76, Math.min(144, Math.round(viewport - errorReserve - noticeReserve)))
  }
  return Math.max(120, Math.min(220, Math.round(viewport * 0.45)))
}
