/** Unit tests for hide-on-scroll root navigation and the Work alert pill invariant. */
import { describe, expect, test } from 'bun:test'
import { INITIAL_SCROLL_NAV, showWorkAlertPill, stepScrollNav } from '../../ios/src/duo/scroll-nav'

describe('hide-on-scroll navigation', () => {
  const base = { contentHeight: 1600, viewportHeight: 700, allowMinimize: true }

  test('minimizes on downward scroll and restores on upward scroll or list ends', () => {
    const down = stepScrollNav(INITIAL_SCROLL_NAV, { ...base, y: 80 })
    expect(down.minimized).toBe(true)

    const tinyJitter = stepScrollNav(down, { ...base, y: 74 })
    expect(tinyJitter.minimized).toBe(true)

    const up = stepScrollNav(down, { ...base, y: 50 })
    expect(up.minimized).toBe(false)

    const downAgain = stepScrollNav(up, { ...base, y: 200 })
    expect(downAgain.minimized).toBe(true)

    const atTop = stepScrollNav(downAgain, { ...base, y: 4 })
    expect(atTop.minimized).toBe(false)

    const atBottom = stepScrollNav(downAgain, { ...base, y: 895 })
    expect(atBottom.minimized).toBe(false)
  })

  test('never minimizes when disallowed (Duo Unfolded Portrait or Duo side strip) or non-scrollable', () => {
    expect(stepScrollNav(INITIAL_SCROLL_NAV, { ...base, y: 120, allowMinimize: false }).minimized).toBe(false)
    expect(stepScrollNav(INITIAL_SCROLL_NAV, { contentHeight: 650, viewportHeight: 700, y: 40, allowMinimize: true }).minimized).toBe(false)
  })

  test('keeps the blue Work alert pill visible whenever minimized and items wait on the owner', () => {
    expect(showWorkAlertPill(true, 3)).toBe(true)
    expect(showWorkAlertPill(true, 0)).toBe(false)
    expect(showWorkAlertPill(false, 3)).toBe(false)
  })
})
