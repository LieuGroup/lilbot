/** Pure keyboard overlap & bounded input height rules for thread pageSheets (mirrors PR #307's keyboardOverlapHeight).
 *  Zero React Native imports so unit tests verify Folded Duo, iPhone, iPad, and AX5 on Linux. */

export interface KeyboardRect {
  height: number
  screenY?: number
}

export interface SheetWindowFrame {
  y: number
  height: number
}

/** Exact overlap (pt) between the software keyboard and the bottom of a Modal pageSheet.
 *  Uses measured sheet bottom (`y + height`) when settled inside the window, falling back to `windowHeight`
 *  so bottom-anchored iPhone / Folded Duo pageSheets never under-pad during presentation. */
export function sheetKeyboardOverlap(windowHeight: number, coords: KeyboardRect | null | undefined, sheetFrame?: SheetWindowFrame | null): number {
  if (!coords || !Number.isFinite(coords.height) || coords.height <= 0) return 0
  if (Number.isFinite(windowHeight) && windowHeight > 0 && typeof coords.screenY === 'number' && Number.isFinite(coords.screenY)) {
    const validFrame =
      sheetFrame &&
      Number.isFinite(sheetFrame.y) &&
      Number.isFinite(sheetFrame.height) &&
      sheetFrame.height > 100 &&
      sheetFrame.y >= 0 &&
      sheetFrame.y + sheetFrame.height <= windowHeight + 4
    const measuredBottom = validFrame ? sheetFrame.y + sheetFrame.height : windowHeight
    const overlap = measuredBottom - coords.screenY
    return overlap > 0 ? Math.round(Math.min(overlap, coords.height)) : 0
  }
  return Math.round(coords.height)
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
