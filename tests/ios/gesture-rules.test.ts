/** Unit tests for Round 4 gesture thresholds, conflict guards, hard invariants, and VoiceOver fallback actions. */
import { describe, expect, test } from 'bun:test'
import {
  EDGE_BACK_ZONE_PT,
  evaluateRowSwipe,
  evaluateTabSwipe,
  HARD_INVARIANT_CONTROLS,
  ROW_SWIPE_GUARD,
  rowAccessibilityActions,
  sendAccessibilityActions,
  shouldAllowEdgeBack,
  shouldCommitEdgeBack,
  shouldDismissSheet,
  shouldExpandPill,
  shouldRevealSearch
} from '../../ios/src/ui/gestures/rules'

describe('Round 4 gesture guards and fallbacks', () => {
  test('locks the 5 hard-invariant visible controls', () => {
    expect(HARD_INVARIANT_CONTROLS).toEqual(['answer', 'stop', 'send', 'attach', 'inspector-close'])
  })

  test('scroll-gated row swipe rejects vertical scroll momentum and Y drift past ±10 pt', () => {
    expect(ROW_SWIPE_GUARD.failOffsetY).toBe(10)
    expect(evaluateRowSwipe({ dx: -90, dy: 0, scrollingVertically: true })).toBe('ignore')
    expect(evaluateRowSwipe({ dx: -90, dy: 11, scrollingVertically: false })).toBe('ignore')
    expect(evaluateRowSwipe({ dx: -90, dy: -12, scrollingVertically: false })).toBe('ignore')
    expect(evaluateRowSwipe({ dx: -5, dy: 0, scrollingVertically: false })).toBe('ignore')
    expect(evaluateRowSwipe({ dx: -30, dy: 4, scrollingVertically: false })).toBe('track')
    expect(evaluateRowSwipe({ dx: -80, dy: 4, scrollingVertically: false })).toBe('open')
    expect(evaluateRowSwipe({ dx: -170, dy: 2, scrollingVertically: false })).toBe('full-action')
  })

  test('edge-swipe back activates only on Standard iPhone leading 20 pt edge (never Folded Duo hinge)', () => {
    expect(shouldAllowEdgeBack({ surface: 'phone', startX: 10, canGoBack: true })).toBe(true)
    expect(shouldAllowEdgeBack({ surface: 'phone', startX: EDGE_BACK_ZONE_PT + 1, canGoBack: true })).toBe(false)
    expect(shouldAllowEdgeBack({ surface: 'phone', startX: 8, canGoBack: false })).toBe(false)
    expect(shouldAllowEdgeBack({ surface: 'duo-folded', startX: 8, canGoBack: true })).toBe(false)
    expect(shouldAllowEdgeBack({ surface: 'duo-unfolded-landscape', startX: 8, canGoBack: true })).toBe(false)

    expect(shouldCommitEdgeBack({ dx: 80, vx: 100 })).toBe(true)
    expect(shouldCommitEdgeBack({ dx: 20, vx: 700 })).toBe(true)
    expect(shouldCommitEdgeBack({ dx: 40, vx: 200 })).toBe(false)
  })

  test('Bot Details horizontal tab swipe yields the leading 20 pt edge to system Back', () => {
    expect(evaluateTabSwipe({ startX: 12, dx: -80, dy: 0, activeIndex: 0, count: 4 })).toBe(0)
    expect(evaluateTabSwipe({ startX: 100, dx: -80, dy: 5, activeIndex: 0, count: 4 })).toBe(1)
    expect(evaluateTabSwipe({ startX: 100, dx: 80, dy: 5, activeIndex: 2, count: 4 })).toBe(1)
    expect(evaluateTabSwipe({ startX: 100, dx: -80, dy: 90, activeIndex: 1, count: 4 })).toBe(1)
    expect(evaluateTabSwipe({ startX: 100, dx: -80, dy: 0, activeIndex: 3, count: 4 })).toBe(3)
  })

  test('Tasks pill swipe-up and sheet swipe-down respect inner scroll offset', () => {
    expect(shouldExpandPill({ dy: -30, vy: -100 })).toBe(true)
    expect(shouldExpandPill({ dy: -8, vy: -500 })).toBe(true)
    expect(shouldExpandPill({ dy: -10, vy: -100 })).toBe(false)

    expect(shouldDismissSheet({ dy: 90, vy: 100, scrollOffsetY: 20 })).toBe(false)
    expect(shouldDismissSheet({ dy: 90, vy: 100, scrollOffsetY: 0 })).toBe(true)
    expect(shouldDismissSheet({ dy: 20, vy: 700, scrollOffsetY: 0 })).toBe(true)
    expect(shouldDismissSheet({ dy: 30, vy: 100, scrollOffsetY: 0 })).toBe(false)
  })

  test('pull-down search and VoiceOver / Assistive Access fallback actions cover every hidden button', () => {
    expect(shouldRevealSearch({ pullDistance: 60, assistiveVisible: false })).toBe(true)
    expect(shouldRevealSearch({ pullDistance: 0, assistiveVisible: true })).toBe(true)
    expect(shouldRevealSearch({ pullDistance: 20, assistiveVisible: false })).toBe(false)

    expect(rowAccessibilityActions({ pinned: false, unread: true, hidden: false }).map(a => a.label)).toEqual(['Pin', 'Mark read', 'Hide', 'Bot menu'])
    expect(rowAccessibilityActions({ pinned: true, unread: false, hidden: true }).map(a => a.label)).toEqual(['Unpin', 'Mark unread', 'Unhide', 'Bot menu'])
    expect(sendAccessibilityActions()).toEqual([{ name: 'model-menu', label: 'Change model and reasoning effort' }])
  })
})
