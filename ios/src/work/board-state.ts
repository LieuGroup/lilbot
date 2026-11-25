/** Pure Work board tab config, time-window math, badge formatting, landscape keyboard metrics, and Duo-safe sheet layout helpers.
 *  Zero React Native runtime imports so every rule is unit-tested on Linux. */

export type WorkBoardTab = 'today' | 'all' | 'checks'
export type WorkAllMode = 'status' | 'bot'
export type WorkWindowKey = '1d' | '7d' | '30d' | 'all'

export const WORK_BOARD_TABS: readonly { id: WorkBoardTab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'all', label: 'All work' },
  { id: 'checks', label: 'Checks' }
] as const

export const WORK_WINDOWS: readonly { id: WorkWindowKey; label: string; ms: number | null }[] = [
  { id: '1d', label: 'Today', ms: 86_400_000 },
  { id: '7d', label: '7 days', ms: 7 * 86_400_000 },
  { id: '30d', label: '30 days', ms: 30 * 86_400_000 },
  { id: 'all', label: 'All time', ms: null }
] as const

/** Computes the minute-aligned `from` epoch for `work.list`, matching `web/src/work/work-all-page.tsx`. */
export function windowStartEpoch(key: WorkWindowKey, now = Date.now()): number | undefined {
  const ms = WORK_WINDOWS.find(w => w.id === key)?.ms ?? null
  return ms ? Math.floor((now - ms) / 60_000) * 60_000 : undefined
}

/** Native iOS tab badge string for the Work tab (`undefined` when zero so no badge draws). */
export function workTabBadge(needsYouCount: number): string | undefined {
  if (needsYouCount <= 0) return undefined
  return needsYouCount > 99 ? '99+' : String(needsYouCount)
}

/** Wraps card actions onto a stacked line at AX sizes (AX1-AX5) or narrow widths so controls never clip. */
export function shouldStackWorkRow(fontScale: number, width?: number): boolean {
  if (fontScale >= 1.5) return true
  if (width !== undefined && width > 0 && width < 280) return true
  return false
}

/** Safe-area padding for native `pageSheet` modals so Folded Duo's trailing rail and landscape cut-outs never overlap controls. */
export function workSheetPadding(insets: { left: number; right: number; bottom: number }) {
  return {
    paddingLeft: Math.max(16, insets.left + 12),
    paddingRight: Math.max(20, insets.right + 12),
    paddingBottom: Math.max(16, insets.bottom + 12)
  }
}

/** Bottom scroll clearance for Work lists and item pages: clears both the software keyboard (+ Done bar) and floating iPhone tab bar. */
export function workScrollBottomPadding(options: { safeBottom: number; keyboardHeight: number; hasFloatingTabBar?: boolean }): number {
  const base = Math.max(28, options.safeBottom + (options.hasFloatingTabBar ? 76 : 24))
  if (options.keyboardHeight > 0) return Math.round(options.keyboardHeight + 76)
  return base
}

/** Height of `WorkKeyboardDoneBar` (44 pt button, 4 pt padding each side, hairline). */
export const WORK_DONE_BAR_HEIGHT = 53

/** Scroll offset that lifts a focused card's bottom (its input and buttons) just above the Done bar, or null when it already shows.
 *  Coordinates are window points; in iPhone landscape the strip above the keyboard is shorter than the card, so the bottom wins. */
export function revealScrollTarget(input: { offset: number; targetY: number; targetHeight: number; visibleBottom: number }): number | null {
  const overflow = input.targetY + input.targetHeight + 8 - input.visibleBottom
  return overflow > 0 ? Math.round(input.offset + overflow) : null
}

/** Compact landscape height metrics for `DropWorkSheet` so Cancel/Drop and the input stay usable above a landscape keyboard. */
export function dropSheetMetrics(input: { sheetHeight: number; keyboardOverlap: number; viewportHeight: number }) {
  const kbUp = input.keyboardOverlap > 0
  const compactLandscape = kbUp && input.sheetHeight > 0 && input.sheetHeight < 520
  const minInputHeight = compactLandscape ? 44 : kbUp ? 68 : 88
  const maxInputHeight = compactLandscape
    ? Math.max(44, Math.min(84, input.viewportHeight > 0 ? input.viewportHeight - 16 : 64))
    : kbUp
      ? Math.max(68, Math.min(144, input.viewportHeight > 0 ? input.viewportHeight - 28 : 112))
      : 200
  return { compactLandscape, minInputHeight, maxInputHeight }
}

/** Dynamic Type caps for Work chrome, headers, rows, chips, and inputs so AX5 stays readable without filling the screen or breaking words. */
export const WORK_TYPE_CAPS = {
  pageTitle: 1.35,
  cardTitle: 1.45,
  subtitle: 1.4,
  sectionHeader: 1.4,
  tabLabel: 1.35,
  actionButton: 1.4,
  rowTitle: 1.55,
  rowMeta: 1.45,
  headerTitle: 1.35,
  badge: 1.35,
  body: 1.65,
  input: 1.5
} as const
