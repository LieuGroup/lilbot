/** Unit tests for iPhone / iPhone Duo surface classification, fold transition guard, split geometry, and 84 pt side strip. */
import { describe, expect, test } from 'bun:test'
import { classifySurface, computeShellLayout, isTransientDuoSize, railSlots, UNCONFIRMED_DUO_METRICS } from '../../ios/src/duo/layout'

describe('Duo surface taxonomy and transition guards', () => {
  test('classifies standard iPhone, Duo folded, Duo unfolded landscape/portrait, and iPad', () => {
    expect(classifySurface({ width: 390, height: 844 })).toBe('phone')
    expect(classifySurface({ width: 430, height: 932 })).toBe('phone')
    expect(classifySurface({ width: 466, height: 678 })).toBe('duo-folded')
    expect(classifySurface({ width: 420, height: 700, safeAreaRight: 84 })).toBe('duo-folded')
    expect(classifySurface({ width: 951, height: 669 })).toBe('duo-unfolded-landscape')
    expect(classifySurface({ width: 669, height: 951 })).toBe('duo-unfolded-portrait')
    expect(classifySurface({ width: 1024, height: 768 })).toBe('pad')
  })

  test('flags transient hinge-motion window sizes for debouncing', () => {
    expect(isTransientDuoSize(466, 562)).toBe(true)
    expect(isTransientDuoSize(951, 553)).toBe(true)
    expect(isTransientDuoSize(466, 678)).toBe(false)
    expect(isTransientDuoSize(951, 669)).toBe(false)
    expect(isTransientDuoSize(390, 844)).toBe(false)
  })
})

describe('Duo split layout and crease clearance', () => {
  test('uses live UIKit safeAreaRight when available and falls back to 84 pt on Duo', () => {
    const fallback = computeShellLayout('duo-unfolded-landscape', { width: 951, height: 669 })
    expect(fallback.hasSideStrip).toBe(true)
    expect(fallback.railWidth).toBe(UNCONFIRMED_DUO_METRICS.railWidth)
    expect(fallback.usableWidth).toBe(867)
    expect(fallback.rosterWidth).toBe(264)
    expect(fallback.creaseBand).toEqual([456, 496])
    // Default roster divider (264 pt) stays cleanly left of the central crease band.
    expect(fallback.rosterWidth).toBeLessThan(fallback.creaseBand![0])

    const liveInset = computeShellLayout('duo-folded', { width: 466, height: 678, safeAreaRight: 88 })
    expect(liveInset.railWidth).toBe(88)
    expect(liveInset.usableWidth).toBe(378)
  })

  test('tucks roster behind sidebar toggle when inspector opens on Duo Unfolded', () => {
    const withInspector = computeShellLayout('duo-unfolded-landscape', { width: 951, height: 669 }, { inspectorOpen: true })
    expect(withInspector.rosterWidth).toBe(0)
    expect(withInspector.inspectorWidth).toBeGreaterThanOrEqual(300)
    expect(withInspector.showSidebarToggle).toBe(true)
  })

  test('pins header minimization off and keeps visible back on Duo Unfolded Portrait (no dead-end)', () => {
    const portrait = computeShellLayout('duo-unfolded-portrait', { width: 669, height: 951 })
    expect(portrait.hasSideStrip).toBe(false)
    expect(portrait.allowHeaderMinimize).toBe(false)
    expect(portrait.requireVisibleBack).toBe(true)

    const phone = computeShellLayout('phone', { width: 390, height: 844 })
    expect(phone.allowHeaderMinimize).toBe(true)
    expect(phone.requireVisibleBack).toBe(false)

    const phoneAssistive = computeShellLayout('phone', { width: 390, height: 844 }, { assistiveAccess: true })
    expect(phoneAssistive.requireVisibleBack).toBe(true)
  })
})

describe('Duo 84 pt trailing side strip slots', () => {
  test('allocates exact Round 4 actions with zero generic inspector or search orbs', () => {
    expect(railSlots('duo-folded', { tab: 'bots', inDetail: false, hasSelectedBot: false, keyboardVisible: false })).toEqual(['new-bot', 'tabs'])
    expect(railSlots('duo-folded', { tab: 'bots', inDetail: true, hasSelectedBot: true, keyboardVisible: false })).toEqual(['back', 'new-chat'])
    expect(railSlots('duo-folded', { tab: 'bots', inDetail: true, hasSelectedBot: true, keyboardVisible: true })).toEqual(['back', 'new-chat', 'dismiss-keyboard'])
    expect(railSlots('duo-unfolded-landscape', { tab: 'bots', inDetail: false, hasSelectedBot: true, keyboardVisible: false })).toEqual(['new-chat', 'tabs'])
    expect(railSlots('duo-unfolded-landscape', { tab: 'work', inDetail: false, hasSelectedBot: true, keyboardVisible: false })).toEqual(['tabs'])
    expect(railSlots('duo-unfolded-landscape', { tab: 'bots', inDetail: false, hasSelectedBot: true, keyboardVisible: true })).toEqual(['new-chat', 'tabs', 'dismiss-keyboard'])
    expect(railSlots('phone', { tab: 'bots', inDetail: false, hasSelectedBot: false, keyboardVisible: false })).toEqual([])
    expect(railSlots('duo-unfolded-portrait', { tab: 'bots', inDetail: false, hasSelectedBot: false, keyboardVisible: false })).toEqual([])
  })
})
