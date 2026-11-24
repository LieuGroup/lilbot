/** Unit tests for Round 4 custom gesture thresholds, conflict guards, hard invariants, and VoiceOver fallback actions. */
import { describe, expect, test } from 'bun:test'
import {
  EDGE_BACK_ZONE_PT,
  evaluateActiveRowSwipe,
  evaluateRowSwipe,
  evaluateTabSwipe,
  HARD_INVARIANT_CONTROLS,
  ROW_SWIPE_GUARD,
  rowAccessibilityActions,
  sendAccessibilityActions,
  shouldDismissSheet,
  shouldExpandPill
} from '../../ios/src/ui/gestures/rules'

describe('Round 4 custom gesture guards and fallbacks', () => {
  test('locks the 5 hard-invariant visible controls', () => {
    expect(HARD_INVARIANT_CONTROLS).toEqual(['answer', 'stop', 'send', 'attach', 'inspector-close'])
  })

  test('scroll-gated row swipe rejects vertical momentum / Y drift pre-activation but tracks smoothly post-activation', () => {
    expect(ROW_SWIPE_GUARD.failOffsetY).toBe(10)
    expect(evaluateRowSwipe({ dx: -90, dy: 0, scrollingVertically: true })).toBe('ignore')
    expect(evaluateRowSwipe({ dx: -90, dy: 11, scrollingVertically: false })).toBe('ignore')
    expect(evaluateRowSwipe({ dx: -90, dy: -12, scrollingVertically: false })).toBe('ignore')
    expect(evaluateRowSwipe({ dx: -5, dy: 0, scrollingVertically: false })).toBe('ignore')
    expect(evaluateRowSwipe({ dx: -30, dy: 4, scrollingVertically: false })).toBe('track')
    expect(evaluateRowSwipe({ dx: -80, dy: 4, scrollingVertically: false })).toBe('open')
    expect(evaluateRowSwipe({ dx: -170, dy: 2, scrollingVertically: false })).toBe('full-action')

    // Once activated, post-activation evaluation depends only on horizontal dx (thumb Y drift never freezes the row).
    expect(evaluateActiveRowSwipe({ dx: -80 })).toBe('open')
    expect(evaluateActiveRowSwipe({ dx: -170 })).toBe('full-action')
    expect(evaluateActiveRowSwipe({ dx: -30 })).toBe('track')
    expect(evaluateActiveRowSwipe({ dx: -5 })).toBe('ignore')
  })

  test('Bot Details horizontal tab swipe yields the leading 20 pt edge to iOS native Back', () => {
    expect(evaluateTabSwipe({ startX: EDGE_BACK_ZONE_PT, dx: -80, dy: 0, activeIndex: 0, count: 4 })).toBe(0)
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

  test('VoiceOver fallback actions cover every hidden swipe and long-press action', () => {
    expect(rowAccessibilityActions({ pinned: false, unread: true, hidden: false }).map(a => a.label)).toEqual(['Pin', 'Mark as read', 'Hide', 'Bot menu'])
    expect(rowAccessibilityActions({ pinned: true, unread: false, hidden: true }).map(a => a.label)).toEqual(['Unpin', 'Mark as unread', 'Show', 'Bot menu'])
    expect(sendAccessibilityActions()).toEqual([{ name: 'model-menu', label: 'Change model and reasoning effort' }])
  })
})
