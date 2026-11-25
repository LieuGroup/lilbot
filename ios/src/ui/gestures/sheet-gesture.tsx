/** Tasks pill swipe-up & sheet swipe-down gesture primitives (R4-G3), each paired with a visible tap/button fallback.
 *  Sheet dismiss disables its pan gesture whenever inner scrollOffsetY > 0 so scrolling back up is never stolen. */
import type { ReactNode } from 'react'
import { type Insets, Pressable, View } from 'react-native'
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler'
import { useTheme } from '../theme'
import { shouldDismissSheet, shouldExpandPill } from './rules'

export interface PillExpandGestureProps {
  accessibilityLabel: string
  onExpand: () => void
  hitSlop?: number | Insets
  children: ReactNode
}

/** Attaches to the 32 pt Tasks pill: swipe up or single tap expands the floating dock. */
export function PillExpandGesture({ accessibilityLabel, onExpand, hitSlop, children }: PillExpandGestureProps) {
  const pan = usePanGesture({
    runOnJS: true,
    activeOffsetY: -10,
    failOffsetX: [-20, 20],
    onDeactivate: event => {
      if (shouldExpandPill({ dy: event.translationY, vy: event.velocityY })) onExpand()
    }
  })

  return (
    <GestureDetector gesture={pan}>
      <Pressable onPress={onExpand} hitSlop={hitSlop} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        {children}
      </Pressable>
    </GestureDetector>
  )
}

export interface SheetDismissGestureProps {
  /** Current inner scroll offset; swipe-down dismiss is disabled while scrolled past y = 0 so it never steals scroll touches. */
  scrollOffsetY: number
  onDismiss: () => void
  /** Fill parent height (default `true` for full-height pageSheets; pass `false` for auto-sized floating cards like the expanded dock). */
  fill?: boolean
  children: ReactNode
}

/** Grab-handle wrapper for Expanded Dock and Opened Worker sheets: swipe down at y <= 0 dismisses without fighting scroll.
 *  Callers must also provide a visible dismiss control (such as "Steer in <bot>" or pane close) so nothing is gesture-only. */
export function SheetDismissGesture({ scrollOffsetY, onDismiss, fill = true, children }: SheetDismissGestureProps) {
  const theme = useTheme()
  const pan = usePanGesture({
    enabled: scrollOffsetY <= 0,
    runOnJS: true,
    activeOffsetY: 14,
    failOffsetX: [-24, 24],
    onDeactivate: event => {
      if (shouldDismissSheet({ dy: event.translationY, vy: event.velocityY, scrollOffsetY })) onDismiss()
    }
  })

  return (
    <GestureDetector gesture={pan}>
      <View
        style={fill ? { flex: 1 } : undefined}
        onAccessibilityEscape={() => {
          onDismiss()
          return true
        }}
      >
        <View style={{ alignItems: 'center', paddingTop: 8, paddingBottom: 4 }}>
          <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: theme.border }} />
        </View>
        {children}
      </View>
    </GestureDetector>
  )
}
