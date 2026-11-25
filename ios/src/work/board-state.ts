/** Pure Work board tab config, time-window math, badge formatting, and Duo-safe sheet layout helpers.
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
  if (fontScale >= 1.6) return true
  if (width !== undefined && width > 0 && width < 280) return true
  return false
}

/** Safe-area padding for native `pageSheet` modals so Folded Duo's trailing rail and clock never overlap controls. */
export function workSheetPadding(insets: { left: number; right: number; bottom: number }) {
  return {
    paddingLeft: Math.max(16, insets.left + 12),
    paddingRight: Math.max(20, insets.right + 12),
    paddingBottom: Math.max(16, insets.bottom + 12)
  }
}

export const WORK_TYPE_CAPS = {
  tabLabel: 1.45,
  actionButton: 1.5,
  rowTitle: 1.85,
  rowMeta: 1.65,
  headerTitle: 1.45,
  badge: 1.4
} as const
