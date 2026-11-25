/** Pure exact deep-history scroll anchoring and multi-pass restore rules for the inverted FlatList.
 *  Handles both same-width remounts (exact measured-height sum) and fold/unfold width changes
 *  (scrollToIndex on the anchored message key), yielding immediately if the user drags. */

export const ROW_GAP = 12
export const CONTENT_PADDING_VERTICAL = 18
export const SCROLL_TO_BOTTOM_THRESHOLD = 280
export const MAX_RESTORE_PASSES = 12
const BOTTOM_EPSILON = 2
const WIDTH_EPSILON = 2

export interface ScrollAnchor {
  /** Stable key of the row at the bottom edge of the inverted viewport. */
  key: string
  /** Pixels scrolled past the start of `key` within that row (>= 0). */
  offsetWithinRow: number
  /** Viewport width when the anchor was captured, to detect fold/unfold reflow. */
  viewportWidth: number
}

export type RestorePlan = { kind: 'none' } | { kind: 'offset'; offset: number; exact: boolean } | { kind: 'index'; index: number }

export interface KeyedRow {
  key: string
}

/** Finds which row sits at `scrollOffset` from the newest edge of the inverted list using measured heights.
 *  Returns `null` when sitting at the bottom (newest messages). */
export function findScrollAnchor(rows: readonly KeyedRow[], rowHeights: Readonly<Record<string, number>>, scrollOffset: number, viewportWidth: number): ScrollAnchor | null {
  if (scrollOffset <= BOTTOM_EPSILON || rows.length === 0) return null
  let cursor = CONTENT_PADDING_VERTICAL
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i].key
    const h = rowHeights[key]
    if (h === undefined || h <= 0) {
      return { key, offsetWithinRow: Math.max(0, scrollOffset - cursor), viewportWidth }
    }
    const stride = h + ROW_GAP
    if (scrollOffset < cursor + stride || i === rows.length - 1) {
      return { key, offsetWithinRow: Math.min(stride, Math.max(0, scrollOffset - cursor)), viewportWidth }
    }
    cursor += stride
  }
  return null
}

/** Computes how to restore reading position on remount: exact measured offset at the same width,
 *  or index-based anchor when viewport width changed across fold/unfold. */
export function computeRestorePlan(
  rows: readonly KeyedRow[],
  rowHeights: Readonly<Record<string, number>>,
  anchor: ScrollAnchor | null,
  fallbackOffset: number,
  viewportWidth: number
): RestorePlan {
  if (!anchor && fallbackOffset <= BOTTOM_EPSILON) return { kind: 'none' }
  if (anchor) {
    const index = rows.findIndex(row => row.key === anchor.key)
    if (index >= 0) {
      const widthChanged = viewportWidth > 0 && anchor.viewportWidth > 0 && Math.abs(viewportWidth - anchor.viewportWidth) >= WIDTH_EPSILON
      if (widthChanged) return { kind: 'index', index }
      let sum = CONTENT_PADDING_VERTICAL
      let allMeasured = true
      for (let i = 0; i < index; i++) {
        const h = rowHeights[rows[i].key]
        if (h === undefined || h <= 0) {
          allMeasured = false
          break
        }
        sum += h + ROW_GAP
      }
      if (allMeasured) return { kind: 'offset', offset: Math.max(0, sum + anchor.offsetWithinRow), exact: true }
    }
  }
  if (fallbackOffset > BOTTOM_EPSILON) return { kind: 'offset', offset: fallbackOffset, exact: false }
  return { kind: 'none' }
}

/** Multi-pass settle state for inverted FlatList restore: keeps refining as deeper items mount,
 *  and stops immediately once settled or when the reader starts dragging. */
export function createScrollRestoreController(needsRestore: boolean, maxPasses = MAX_RESTORE_PASSES) {
  let active = needsRestore
  let passes = 0
  let lastOffset: number | null = null
  let lastContentHeight = 0

  return {
    isRestoring: () => active,
    canRecordScroll: () => !active,
    onUserDrag: () => {
      active = false
    },
    onContentSize: (contentHeight: number, targetOffset: number, exact: boolean, viewportHeight = 0): boolean => {
      if (!active) return false
      if (passes >= maxPasses) {
        active = false
        return false
      }
      const heightChanged = Math.abs(contentHeight - lastContentHeight) >= 1
      const offsetChanged = lastOffset === null || Math.abs(targetOffset - lastOffset) >= 1
      if (!heightChanged && !offsetChanged && passes > 0) {
        active = false
        return false
      }
      passes += 1
      lastContentHeight = contentHeight
      lastOffset = targetOffset
      const maxScrollable = Math.max(0, contentHeight - viewportHeight)
      if (exact && maxScrollable >= targetOffset && passes >= 2 && !heightChanged) active = false
      return true
    },
    markSettled: () => {
      active = false
    }
  }
}

export const shouldShowScrollToBottom = (scrollOffset: number) => scrollOffset >= SCROLL_TO_BOTTOM_THRESHOLD
