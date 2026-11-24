/** Unit tests for the mobile Liquid Glass token layer mapped onto LilBot's existing web palette. */
import { describe, expect, test } from 'bun:test'
import { composerInputMaxHeight, DYNAMIC_TYPE_CAPS, pinnedTileColumns, rosterRowTextLines, scaledRowAvatarSize } from '../../ios/src/ui/dynamic-type'
import { GLASS_METRICS, glassFallbackBackground, MOBILE_SCALE, palettes, radius, SURFACE_LAYER, type } from '../../ios/src/ui/tokens'

describe('iOS Liquid Glass tokens', () => {
  test('light and dark palettes preserve exact web token values and expose complete glass sub-tokens', () => {
    expect(palettes.light.background).toBe('#f6f6f4')
    expect(palettes.light.foreground).toBe('#1b1c1f')
    expect(palettes.light.primary).toBe('#2f5fe0')
    expect(palettes.dark.background).toBe('#0f1115')
    expect(palettes.dark.foreground).toBe('#e8e9ec')
    expect(palettes.dark.primary).toBe('#5b84f1')

    for (const mode of ['light', 'dark'] as const) {
      const glass = palettes[mode].glass
      expect(glass.fill).toMatch(/^rgba\(/)
      expect(glass.border).toMatch(/^rgba\(/)
      expect(glass.specular).toMatch(/^rgba\(/)
      expect(glass.activePill).toMatch(/^rgba\(/)
      expect(glass.scrim).toMatch(/^rgba\(/)
    }

    // Light glass fill is warm-frosted (not pure #ffffff) so floating pills separate cleanly over the white chat canvas.
    expect(palettes.light.glass.fill).toBe('rgba(248,248,246,0.82)')
    expect(palettes.dark.glass.fill).toBe('rgba(30,34,42,0.80)')
  })

  test('Reduce Transparency keeps standard chrome on theme.popover and media scrims opaque dark', () => {
    expect(glassFallbackBackground(palettes.light, { reduceTransparency: true, scrim: false })).toBe(palettes.light.popover)
    expect(glassFallbackBackground(palettes.dark, { reduceTransparency: true, scrim: false })).toBe(palettes.dark.popover)
    expect(glassFallbackBackground(palettes.light, { reduceTransparency: true, scrim: true })).toBe('#0f1115')
    expect(glassFallbackBackground(palettes.dark, { reduceTransparency: true, scrim: true })).toBe('#0f1115')
    expect(glassFallbackBackground(palettes.light, { reduceTransparency: false, scrim: true })).toBe(palettes.light.glass.scrim)
    expect(glassFallbackBackground(palettes.light, { reduceTransparency: false, scrim: false })).toBe(palettes.light.glass.fill)
  })

  test('enforces strict two-layer material contract, closed type scale, and 44 pt minimum touch target', () => {
    expect(SURFACE_LAYER).toEqual({ chrome: 'glass', content: 'solid' })
    expect(type).toEqual({
      meta: { fontSize: 12, lineHeight: 16 },
      preview: { fontSize: 13, lineHeight: 18 },
      name: { fontSize: 14, lineHeight: 20 },
      chat: { fontSize: 15, lineHeight: 22 },
      title: { fontSize: 16, lineHeight: 22 },
      metric: { fontSize: 28, lineHeight: 32 }
    })
    expect(radius.pill).toBe(9999)
    expect(GLASS_METRICS).toEqual({
      orbSize: 44,
      tabBarHeight: 44,
      railTabWidth: 48,
      tasksPillHeight: 32,
      minTouchTarget: 44
    })
    expect(MOBILE_SCALE).toEqual({
      roster: {
        pinnedAvatarTwoUp: 80,
        pinnedAvatarThreeUp: 64,
        pinnedAvatarSplitTwoUp: 64,
        pinnedAvatarSplitThreeUp: 52,
        pinnedLabel: { fontSize: 15, lineHeight: 20 },
        sectionHeader: { fontSize: 15, lineHeight: 20 },
        rowAvatar: 46,
        rowAvatarSplit: 40,
        rowMinHeight: 76,
        rowMinHeightSplit: 66,
        rowName: { fontSize: 17, lineHeight: 22 },
        rowPreview: { fontSize: 15, lineHeight: 20 },
        rowTime: { fontSize: 13, lineHeight: 18 }
      },
      chat: {
        message: { fontSize: 18, lineHeight: 26 },
        statusLine: { fontSize: 15, lineHeight: 20 },
        bubbleRadius: 20,
        bubblePaddingX: 16,
        bubblePaddingY: 12,
        composerMinHeight: 54,
        composerRadius: 26,
        composerInput: { fontSize: 18, lineHeight: 25 },
        composerActionSize: 36
      }
    })
    expect(pinnedTileColumns(2, 1.0)).toBe(2)
    expect(pinnedTileColumns(3, 1.0)).toBe(3)
    expect(pinnedTileColumns(3, 1.35)).toBe(2)
    expect(pinnedTileColumns(2, 2.0)).toBe(1)
    expect(rosterRowTextLines(1.0)).toBe(1)
    expect(rosterRowTextLines(1.35)).toBe(1)
    expect(rosterRowTextLines(1.6)).toBe(2)
    expect(scaledRowAvatarSize(46, 1.0)).toBe(46)
    expect(scaledRowAvatarSize(46, 1.35)).toBe(62)
    expect(scaledRowAvatarSize(46, 3.0)).toBe(62)
    expect(composerInputMaxHeight(1.0)).toBe(132)
    expect(composerInputMaxHeight(2.5)).toBe(264)
    expect(DYNAMIC_TYPE_CAPS).toEqual({
      pinnedLabel: 1.6,
      sectionHeader: 1.6,
      rowTime: 1.6,
      modelPill: 1.5,
      composerInput: 2.0
    })
  })
})
