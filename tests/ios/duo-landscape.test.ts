/** Surface classification in both orientations for every device, plus the short-landscape composer rules. */
import { describe, expect, test } from 'bun:test'
import { composerChromeSpacing } from '../../ios/src/chat/composer-state'
import { classifySurface, computeShellLayout, isTransientDuoSize } from '../../ios/src/duo/layout'
import { composerInputMaxHeight } from '../../ios/src/ui/dynamic-type'

describe('surface in portrait and landscape', () => {
  test('ordinary iPhones stay phone in both orientations, even with landscape side insets', () => {
    for (const [w, h] of [
      [390, 844],
      [402, 874],
      [430, 932],
      [375, 812],
      [375, 667]
    ]) {
      expect(classifySurface({ width: w, height: h })).toBe('phone')
      expect(classifySurface({ width: h, height: w })).toBe('phone')
      expect(classifySurface({ width: h, height: w, safeAreaLeft: 62, safeAreaRight: 62 })).toBe('phone')
    }
  })

  test('folded Duo is duo-folded in portrait and in both landscape rotations, with or without the trait', () => {
    expect(classifySurface({ width: 466, height: 678 })).toBe('duo-folded')
    expect(classifySurface({ width: 466, height: 678, safeAreaRight: 84, verticalBarEdge: 'trailing' })).toBe('duo-folded')
    expect(classifySurface({ width: 678, height: 466 })).toBe('duo-folded')
    expect(classifySurface({ width: 678, height: 466, safeAreaRight: 84 })).toBe('duo-folded')
    expect(classifySurface({ width: 678, height: 466, safeAreaLeft: 84 })).toBe('duo-folded')
    expect(classifySurface({ width: 678, height: 466, safeAreaRight: 84, verticalBarEdge: 'trailing' })).toBe('duo-folded')
    expect(classifySurface({ width: 678, height: 466, safeAreaLeft: 84, verticalBarEdge: 'leading' })).toBe('duo-folded')
  })

  test('unfolded Duo keeps its own surfaces in both orientations', () => {
    expect(classifySurface({ width: 951, height: 669 })).toBe('duo-unfolded-landscape')
    expect(classifySurface({ width: 951, height: 669, safeAreaRight: 84, verticalBarEdge: 'trailing' })).toBe('duo-unfolded-landscape')
    expect(classifySurface({ width: 669, height: 951 })).toBe('duo-unfolded-portrait')
  })

  test('iPads stay pad at full size and never become Duo in Split View or Slide Over', () => {
    for (const [w, h] of [
      [1024, 768],
      [768, 1024],
      [1133, 744],
      [744, 1133],
      [1376, 1032],
      [1032, 1376]
    ]) {
      expect(classifySurface({ width: w, height: h, isPad: true })).toBe('pad')
    }
    expect(classifySurface({ width: 694, height: 1024, isPad: true })).toBe('phone')
    expect(classifySurface({ width: 507, height: 744, isPad: true })).toBe('phone')
    expect(classifySurface({ width: 678, height: 466, isPad: true })).toBe('phone')
    expect(classifySurface({ width: 466, height: 678, isPad: true })).toBe('phone')
    expect(classifySurface({ width: 320, height: 1024, isPad: true })).toBe('phone')
    expect(classifySurface({ width: 981, height: 1024, isPad: true })).toBe('pad')
  })

  test('hinge-motion sizes are transient in both orientations and still settle as folded', () => {
    expect(isTransientDuoSize(466, 562)).toBe(true)
    expect(isTransientDuoSize(562, 466)).toBe(true)
    expect(classifySurface({ width: 562, height: 466 })).toBe('duo-folded')
  })
})

describe('folded Duo landscape shell', () => {
  test('strip on the trailing side reserves the right inset', () => {
    const layout = computeShellLayout('duo-folded', { width: 678, height: 466, safeAreaRight: 84, verticalBarEdge: 'trailing' })
    expect(layout.hasSideStrip).toBe(true)
    expect(layout.railWidth).toBe(84)
    expect(layout.usableWidth).toBe(594)
    expect(layout.splitMode).toBe(false)
  })

  test('strip on the leading side reserves the left inset, from the trait or from insets alone', () => {
    const fromTrait = computeShellLayout('duo-folded', { width: 678, height: 466, safeAreaLeft: 84, verticalBarEdge: 'leading' })
    const fromInsets = computeShellLayout('duo-folded', { width: 678, height: 466, safeAreaLeft: 84 })
    for (const layout of [fromTrait, fromInsets]) {
      expect(layout.railWidth).toBe(84)
      expect(layout.usableWidth).toBe(594)
      expect(layout.horizontalPadding).toEqual({ left: 84, right: 0 })
    }
  })

  test('without measured insets the fallback rail is reserved once, never twice', () => {
    expect(computeShellLayout('duo-folded', { width: 678, height: 466 }).usableWidth).toBe(594)
  })
})

describe('short-landscape composer', () => {
  test('input height is capped only when the viewport is 500 pt or shorter', () => {
    expect(composerInputMaxHeight(1)).toBe(132)
    expect(composerInputMaxHeight(1, 874)).toBe(132)
    expect(composerInputMaxHeight(1, 678)).toBe(132)
    expect(composerInputMaxHeight(1, 466)).toBe(65)
    expect(composerInputMaxHeight(2.5, 466)).toBe(65)
    expect(composerInputMaxHeight(1, 300)).toBe(44)
    expect(composerInputMaxHeight(2.5, 951)).toBe(264)
  })

  test('chrome tightens only with the keyboard open on a short viewport', () => {
    const portrait = composerChromeSpacing({ viewportHeight: 678, expanded: true, keyboardOpen: true, bottomInset: 34 })
    expect(portrait).toEqual({ compactLandscape: false, outerPaddingTop: 4, outerPaddingBottom: 12, cardPaddingTop: 12, cardPaddingBottom: 10, toolbarMarginTop: 10 })
    const resting = composerChromeSpacing({ viewportHeight: 466, expanded: false, keyboardOpen: false, bottomInset: 21 })
    expect(resting).toEqual({ compactLandscape: false, outerPaddingTop: 4, outerPaddingBottom: 21, cardPaddingTop: 9, cardPaddingBottom: 9, toolbarMarginTop: 10 })
    const typing = composerChromeSpacing({ viewportHeight: 466, expanded: true, keyboardOpen: true, bottomInset: 21 })
    expect(typing).toEqual({ compactLandscape: true, outerPaddingTop: 2, outerPaddingBottom: 6, cardPaddingTop: 8, cardPaddingBottom: 6, toolbarMarginTop: 6 })
  })
})
