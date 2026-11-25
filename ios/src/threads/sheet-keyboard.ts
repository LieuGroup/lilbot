/** Pure pageSheet keyboard inset & bounded multiline input height helpers for `AnswerWorkSheet`.
 *  Builds directly on the shared `useKeyboardHeight` value from `ios/src/ui/use-keyboard-height.ts`. */

export interface SheetWindowFrame {
  y: number
  height: number
}

/** Converts window-level `keyboardHeight` (from `useKeyboardHeight`) into the exact bottom overlap inside
 *  a Modal pageSheet: identical to `keyboardHeight` on bottom-anchored iPhone / Folded Duo sheets, and
 *  trims any gap below centered iPad pageSheets once `measureInWindow` settles. */
export function sheetKeyboardInset(windowHeight: number, keyboardHeight: number, sheetFrame?: SheetWindowFrame | null): number {
  const kb = Math.max(0, Math.round(keyboardHeight))
  if (kb === 0) return 0
  const validFrame =
    sheetFrame &&
    Number.isFinite(windowHeight) &&
    windowHeight > 0 &&
    Number.isFinite(sheetFrame.y) &&
    Number.isFinite(sheetFrame.height) &&
    sheetFrame.height > 100 &&
    sheetFrame.y >= 0 &&
    sheetFrame.y + sheetFrame.height <= windowHeight + 4
  if (!validFrame) return kb
  const gapBelowSheet = Math.max(0, Math.round(windowHeight - (sheetFrame.y + sheetFrame.height)))
  return Math.max(0, kb - gapBelowSheet)
}

/** Caps multiline answer TextInput height so a 10-line answer scrolls inside the input while keeping
 *  the question and pinned Cancel / Send answer footer visible above the software keyboard. */
export function answerInputMaxHeight(input: { sheetHeight: number; keyboardOverlap: number; fontScale: number }): number {
  const available = Math.max(0, input.sheetHeight - input.keyboardOverlap)
  if (input.keyboardOverlap > 0) {
    const reserve = input.fontScale >= 1.5 ? 216 : 196
    return Math.max(84, Math.min(148, Math.round(available - reserve)))
  }
  return Math.max(120, Math.min(220, Math.round(available * 0.35)))
}
