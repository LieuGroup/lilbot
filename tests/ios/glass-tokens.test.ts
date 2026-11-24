/** Unit tests for the mobile Liquid Glass token layer mapped onto LilBot's existing web palette. */
import { describe, expect, test } from 'bun:test'
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
    expect(GLASS_METRICS.minTouchTarget).toBeGreaterThanOrEqual(44)
    expect(GLASS_METRICS.orbSize).toBe(44)
    expect(GLASS_METRICS.tasksPillHeight).toBe(32)
    expect(GLASS_METRICS.composerRestHeight).toBe(42)
    expect(MOBILE_SCALE.roster.pinnedAvatarTwoUp).toBe(80)
    expect(MOBILE_SCALE.roster.rowAvatar).toBe(46)
    expect(MOBILE_SCALE.roster.rowMinHeight).toBe(76)
    expect(MOBILE_SCALE.roster.rowName).toEqual({ fontSize: 17, lineHeight: 22 })
    expect(MOBILE_SCALE.roster.rowPreview).toEqual({ fontSize: 15, lineHeight: 20 })
    expect(MOBILE_SCALE.chat.message).toEqual({ fontSize: 17, lineHeight: 25 })
    expect(MOBILE_SCALE.chat.composerMinHeight).toBe(52)
    expect(MOBILE_SCALE.chat.composerRadius).toBe(26)
  })
})
