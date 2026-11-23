/** Pure gesture thresholds, conflict guards, hard invariants, and VoiceOver accessibility action builders (R4-00).
 *  Native stack/tabs handle back navigation and Assistive Access Back; this module governs custom gestures only.
 *  Zero React Native runtime imports so every rule is unit-tested on Linux. */

/** Five controls NEVER replaced by a gesture whenever their state applies (build-spec.md §5A). */
export const HARD_INVARIANT_CONTROLS = ['answer', 'stop', 'send', 'attach', 'inspector-close'] as const
export type HardInvariantControl = (typeof HARD_INVARIANT_CONTROLS)[number]

/** Scroll-gated row swipe thresholds (R4-G2): FAIL_OFFSET_Y ±10 pt + vertical momentum lock prior to activation. */
export const ROW_SWIPE_GUARD = {
  failOffsetY: 10,
  activeOffsetX: -12,
  openThreshold: 72,
  fullSwipeThreshold: 160
} as const

export type RowSwipeDecision = 'ignore' | 'track' | 'open' | 'full-action'

/** Pre-activation check: rejects vertical scroll momentum and Y drift past ±10 pt before horizontal swipe activates. */
export function evaluateRowSwipe(input: { dx: number; dy: number; scrollingVertically: boolean }): RowSwipeDecision {
  if (input.scrollingVertically) return 'ignore'
  if (Math.abs(input.dy) > ROW_SWIPE_GUARD.failOffsetY) return 'ignore'
  return evaluateActiveRowSwipe({ dx: input.dx })
}

/** Post-activation check: once horizontal swipe is active, thumb drift along Y never freezes or snaps the row shut. */
export function evaluateActiveRowSwipe(input: { dx: number }): RowSwipeDecision {
  if (input.dx > ROW_SWIPE_GUARD.activeOffsetX) return 'ignore'
  const distance = Math.abs(input.dx)
  if (distance >= ROW_SWIPE_GUARD.fullSwipeThreshold) return 'full-action'
  if (distance >= ROW_SWIPE_GUARD.openThreshold) return 'open'
  return 'track'
}

/** Leading edge reserved for iOS native interactive back pop; custom horizontal swipes must yield this zone. */
export const EDGE_BACK_ZONE_PT = 20

/** Bot Details horizontal tab swipe (R4-00): confined to Details body; leading 20 pt edge yields to system Back. */
export function evaluateTabSwipe(input: { startX: number; dx: number; dy: number; activeIndex: number; count: number }): number {
  if (input.count <= 1) return input.activeIndex
  if (input.startX <= EDGE_BACK_ZONE_PT) return input.activeIndex
  if (Math.abs(input.dy) >= Math.abs(input.dx) || Math.abs(input.dx) < 36) return input.activeIndex
  const next = input.dx < 0 ? input.activeIndex + 1 : input.activeIndex - 1
  return Math.max(0, Math.min(input.count - 1, next))
}

/** Tasks pill swipe-up & sheet swipe-down rules (R4-G3). */
export const SHEET_GESTURE_THRESHOLDS = {
  pillExpandDy: 24,
  pillExpandVy: 450,
  sheetDismissDy: 72,
  sheetDismissVy: 650
} as const

export function shouldExpandPill(input: { dy: number; vy: number }): boolean {
  return input.dy <= -SHEET_GESTURE_THRESHOLDS.pillExpandDy || input.vy <= -SHEET_GESTURE_THRESHOLDS.pillExpandVy
}

/** Sheet dismiss never fights inner scrolling: gesture only activates and commits when inner scroll is at y <= 0. */
export function shouldDismissSheet(input: { dy: number; vy: number; scrollOffsetY: number }): boolean {
  if (input.scrollOffsetY > 0) return false
  return input.dy >= SHEET_GESTURE_THRESHOLDS.sheetDismissDy || input.vy >= SHEET_GESTURE_THRESHOLDS.sheetDismissVy
}

/** Pull-down search on Roster top (R4-G4), with always-visible fallback when screen reader / accessible search is active. */
export const SEARCH_PULL_THRESHOLD_PT = 56

export function shouldRevealSearch(input: { pullDistance: number; alwaysVisible: boolean }): boolean {
  return input.alwaysVisible || input.pullDistance >= SEARCH_PULL_THRESHOLD_PT
}

export interface AccessibleActionSpec {
  name: string
  label: string
}

/** VoiceOver custom actions mirroring swipe-left and long-press on every bot row (build-spec.md §5B). */
export function rowAccessibilityActions(state: { pinned: boolean; unread: boolean; hidden: boolean }): AccessibleActionSpec[] {
  return [
    { name: 'toggle-pin', label: state.pinned ? 'Unpin' : 'Pin' },
    { name: 'toggle-unread', label: state.unread ? 'Mark read' : 'Mark unread' },
    { name: 'toggle-hide', label: state.hidden ? 'Unhide' : 'Hide' },
    { name: 'open-menu', label: 'Bot menu' }
  ]
}

/** VoiceOver custom action mirroring long-press Send for Model & Reasoning Effort (build-spec.md §5B). */
export function sendAccessibilityActions(): AccessibleActionSpec[] {
  return [{ name: 'model-menu', label: 'Change model and reasoning effort' }]
}
