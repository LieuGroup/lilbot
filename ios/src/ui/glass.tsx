/** Floating Liquid Glass primitives for the chrome layer only (tabs, orbs, pills, composer, sheets).
 *  Uses native expo-glass-effect on iOS 26+ and falls back to frosted glass tokens everywhere else. */
import { GlassView, isLiquidGlassAvailable, type GlassStyle } from 'expo-glass-effect'
import type { ReactNode } from 'react'
import { Pressable, type AccessibilityActionEvent, type AccessibilityActionInfo, type PressableProps, type StyleProp, View, type ViewStyle } from 'react-native'
import { useTheme } from './theme'
import { GLASS_METRICS, radius } from './tokens'

export interface GlassSurfaceProps {
  children: ReactNode
  /** Regular glass for all text-bearing chrome; clear only for minimal media overlays with a dark scrim. */
  variant?: Extract<GlassStyle, 'regular' | 'clear'>
  interactive?: boolean
  scrim?: boolean
  style?: StyleProp<ViewStyle>
}

export function GlassSurface({ children, variant = 'regular', interactive = false, scrim = false, style }: GlassSurfaceProps) {
  const theme = useTheme()
  const nativeGlass = isLiquidGlassAvailable()
  const surfaceStyle: ViewStyle = {
    borderWidth: 1,
    borderColor: theme.glass.border,
    backgroundColor: nativeGlass ? (scrim ? theme.glass.scrim : 'transparent') : scrim ? theme.glass.scrim : theme.glass.fill,
    overflow: 'hidden'
  }

  if (nativeGlass) {
    return (
      <GlassView glassEffectStyle={variant} tintColor={variant === 'regular' ? theme.glass.fill : undefined} isInteractive={interactive} style={[surfaceStyle, style]}>
        {children}
      </GlassView>
    )
  }

  return (
    <View style={[surfaceStyle, style]}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 1, backgroundColor: theme.glass.specular }} />
      {children}
    </View>
  )
}

export interface GlassPillProps {
  children: ReactNode
  height?: number
  style?: StyleProp<ViewStyle>
  interactive?: boolean
}

export function GlassPill({ children, height = GLASS_METRICS.tabBarHeight, style, interactive = true }: GlassPillProps) {
  return (
    <GlassSurface interactive={interactive} style={[{ minHeight: height, borderRadius: radius.pill }, style]}>
      {children}
    </GlassSurface>
  )
}

export interface GlassOrbProps extends Omit<PressableProps, 'style' | 'children'> {
  children: ReactNode
  size?: number
  accessibilityLabel: string
  accessibilityActions?: readonly AccessibilityActionInfo[]
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void
  style?: StyleProp<ViewStyle>
}

export function GlassOrb({ children, size = GLASS_METRICS.orbSize, accessibilityLabel, style, disabled, ...rest }: GlassOrbProps) {
  const pad = Math.max(0, Math.ceil((GLASS_METRICS.minTouchTarget - size) / 2))
  return (
    <Pressable
      {...rest}
      disabled={disabled}
      hitSlop={pad > 0 ? pad : undefined}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.78 : 1 }, style]}
    >
      <GlassSurface interactive style={{ width: size, height: size, borderRadius: size / 2, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </GlassSurface>
    </Pressable>
  )
}
