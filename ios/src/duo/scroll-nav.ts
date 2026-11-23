/** Pure hide-on-scroll navigation state machine (build-spec.md §6).
 *  Standard iPhone bottom tab bar minimizes on downward scroll while keeping the blue Work alert pill visible. */
export interface ScrollNavState {
  minimized: boolean
  lastY: number
}

export interface ScrollNavInput {
  y: number
  contentHeight: number
  viewportHeight: number
  allowMinimize: boolean
}

export const SCROLL_NAV_THRESHOLDS = {
  minimizeDelta: 18,
  restoreDelta: 12,
  edgeThreshold: 12
} as const

export const INITIAL_SCROLL_NAV: ScrollNavState = { minimized: false, lastY: 0 }

export function stepScrollNav(prev: ScrollNavState, input: ScrollNavInput): ScrollNavState {
  const y = Math.max(0, input.y)
  if (!input.allowMinimize) return { minimized: false, lastY: y }

  const scrollable = input.contentHeight > input.viewportHeight + SCROLL_NAV_THRESHOLDS.edgeThreshold
  const atTop = y <= SCROLL_NAV_THRESHOLDS.edgeThreshold
  const atBottom = scrollable && y + input.viewportHeight >= input.contentHeight - SCROLL_NAV_THRESHOLDS.edgeThreshold
  if (!scrollable || atTop || atBottom) return { minimized: false, lastY: y }

  const delta = y - prev.lastY
  if (delta >= SCROLL_NAV_THRESHOLDS.minimizeDelta) return { minimized: true, lastY: y }
  if (delta <= -SCROLL_NAV_THRESHOLDS.restoreDelta) return { minimized: false, lastY: y }
  return prev
}

/** Hard invariant: when the bottom tab bar minimizes, the blue Work count pill stays visible if any item waits on the user. */
export function showWorkAlertPill(minimized: boolean, workNeedsYouCount: number): boolean {
  return minimized && workNeedsYouCount > 0
}
