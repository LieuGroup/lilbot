/** Unit tests for iPhone / iPhone Duo surface classification, fold transition guard, crease clearance, and sidebar toggle. */
import { describe, expect, test } from 'bun:test'
import { avoidCrease, classifySurface, computeShellLayout, isTransientDuoSize, nextSidebarState, surfaceTransitionDelayMs, UNCONFIRMED_DUO_METRICS } from '../../ios/src/duo/layout'

describe('Duo surface taxonomy and transition guards', () => {
  test('classifies Standard iPhone (portrait and rotated landscape), Duo folded, Duo unfolded, and iPads', () => {
    expect(classifySurface({ width: 390, height: 844 })).toBe('phone')
    expect(classifySurface({ width: 430, height: 932 })).toBe('phone')
    // Rotated Standard iPhones must never misclassify as duo-unfolded-landscape.
    expect(classifySurface({ width: 844, height: 390 })).toBe('phone')
    expect(classifySurface({ width: 932, height: 430 })).toBe('phone')
    expect(classifySurface({ width: 812, height: 375 })).toBe('phone')

    expect(classifySurface({ width: 466, height: 678 })).toBe('duo-folded')
    expect(classifySurface({ width: 420, height: 700, safeAreaRight: 84 })).toBe('duo-folded')
    expect(classifySurface({ width: 951, height: 669 })).toBe('duo-unfolded-landscape')
    expect(classifySurface({ width: 669, height: 951 })).toBe('duo-unfolded-portrait')

    // iPads in both portrait and landscape (including iPad Mini portrait 744x1133).
    expect(classifySurface({ width: 1024, height: 768 })).toBe('pad')
    expect(classifySurface({ width: 768, height: 1024 })).toBe('pad')
    expect(classifySurface({ width: 744, height: 1133 })).toBe('pad')
    expect(classifySurface({ width: 1133, height: 744 })).toBe('pad')
  })

  test('flags transient hinge-motion window sizes and converges any held band via finite debounce', () => {
    expect(isTransientDuoSize(466, 562)).toBe(true)
    expect(isTransientDuoSize(951, 553)).toBe(true)
    expect(isTransientDuoSize(466, 678)).toBe(false)
    expect(isTransientDuoSize(951, 669)).toBe(false)
    expect(isTransientDuoSize(390, 844)).toBe(false)

    // Both transient bands must still classify to their settled Duo mode and converge after a finite delay (never freeze).
    const foldedHeld = classifySurface({ width: 466, height: 562 })
    expect(foldedHeld).toBe('duo-folded')
    expect(surfaceTransitionDelayMs('duo-unfolded-landscape', foldedHeld, 466, 562)).toBe(UNCONFIRMED_DUO_METRICS.transientTransitionDebounceMs)
    expect(surfaceTransitionDelayMs(foldedHeld, foldedHeld, 466, 562)).toBeNull()

    const unfoldedHeld = classifySurface({ width: 951, height: 553 })
    expect(unfoldedHeld).toBe('duo-unfolded-landscape')
    expect(surfaceTransitionDelayMs('duo-folded', unfoldedHeld, 951, 553)).toBe(UNCONFIRMED_DUO_METRICS.transientTransitionDebounceMs)
    expect(surfaceTransitionDelayMs(unfoldedHeld, unfoldedHeld, 951, 553)).toBeNull()

    // Non-transient settled transitions use the standard debounce.
    expect(surfaceTransitionDelayMs('duo-folded', 'duo-unfolded-landscape', 951, 669)).toBe(UNCONFIRMED_DUO_METRICS.transitionDebounceMs)
  })
})

describe('Duo split layout, horizontal safe-area insets, crease clearance, and sidebar toggle', () => {
  test('propagates left/right safe-area insets for rotated phone and Duo rail at zero portrait cost', () => {
    const portraitPhone = computeShellLayout('phone', { width: 390, height: 844, safeAreaLeft: 0, safeAreaRight: 0 })
    expect(portraitPhone.horizontalPadding).toEqual({ left: 0, right: 0 })
    expect(portraitPhone.usableWidth).toBe(390)

    const landscapePhone = computeShellLayout('phone', { width: 874, height: 402, safeAreaLeft: 59, safeAreaRight: 59 })
    expect(landscapePhone.horizontalPadding).toEqual({ left: 59, right: 59 })
    expect(landscapePhone.usableWidth).toBe(756)

    const duoFolded = computeShellLayout('duo-folded', { width: 466, height: 678, safeAreaLeft: 0, safeAreaRight: 84 })
    expect(duoFolded.horizontalPadding).toEqual({ left: 0, right: 84 })
    expect(duoFolded.railWidth).toBe(84)
    expect(duoFolded.usableWidth).toBe(382)

    const duoUnfolded = computeShellLayout('duo-unfolded-landscape', { width: 951, height: 669, safeAreaLeft: 0, safeAreaRight: 84 })
    expect(duoUnfolded.horizontalPadding).toEqual({ left: 0, right: 84 })
    expect(duoUnfolded.railWidth).toBe(84)
    expect(duoUnfolded.usableWidth).toBe(867)
    expect(duoUnfolded.rosterWidth).toBe(264)
  })
  test('uses live UIKit safeAreaRight when available and keeps split dividers clear of the crease', () => {
    const fallback = computeShellLayout('duo-unfolded-landscape', { width: 951, height: 669 })
    expect(fallback.hasSideStrip).toBe(true)
    expect(fallback.railWidth).toBe(UNCONFIRMED_DUO_METRICS.railWidth)
    expect(fallback.usableWidth).toBe(867)
    expect(fallback.rosterWidth).toBe(264)
    expect(fallback.creaseBand).toEqual([456, 496])
    expect(fallback.rosterWidth).toBeLessThan(fallback.creaseBand![0])

    expect(avoidCrease(470, [456, 496], 'left')).toBe(456)
    expect(avoidCrease(470, [456, 496], 'right')).toBe(496)
    expect(avoidCrease(264, [456, 496], 'left')).toBe(264)

    const liveInset = computeShellLayout('duo-folded', { width: 466, height: 678, safeAreaRight: 88 })
    expect(liveInset.railWidth).toBe(88)
    expect(liveInset.usableWidth).toBe(378)
  })

  test('tucks roster behind sidebar toggle when inspector opens, and one tap restores roster', () => {
    const withInspector = computeShellLayout('duo-unfolded-landscape', { width: 951, height: 669 }, { inspectorOpen: true })
    expect(withInspector.rosterWidth).toBe(0)
    expect(withInspector.inspectorWidth).toBeGreaterThanOrEqual(UNCONFIRMED_DUO_METRICS.minInspectorWidth)
    expect(withInspector.showSidebarToggle).toBe(true)

    expect(nextSidebarState({ sidebarOpen: true, inspectorOpen: true })).toEqual({ sidebarOpen: true, inspectorOpen: false })
    expect(nextSidebarState({ sidebarOpen: false, inspectorOpen: true })).toEqual({ sidebarOpen: true, inspectorOpen: false })
    expect(nextSidebarState({ sidebarOpen: true, inspectorOpen: false })).toEqual({ sidebarOpen: false, inspectorOpen: false })
    expect(nextSidebarState({ sidebarOpen: false, inspectorOpen: false })).toEqual({ sidebarOpen: true, inspectorOpen: false })
  })

  test('pins native tab bar minimization to never on Duo Unfolded Portrait and onScrollDown on phone', () => {
    const portrait = computeShellLayout('duo-unfolded-portrait', { width: 669, height: 951 })
    expect(portrait.hasSideStrip).toBe(false)
    expect(portrait.allowHeaderMinimize).toBe(false)
    expect(portrait.tabBarMinimizeBehavior).toBe('never')

    const phone = computeShellLayout('phone', { width: 390, height: 844 })
    expect(phone.allowHeaderMinimize).toBe(true)
    expect(phone.tabBarMinimizeBehavior).toBe('onScrollDown')
  })
})
