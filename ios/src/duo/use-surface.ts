/** Live Duo/iPhone surface hook with ~150 ms fold-transition debounce, trusting live UIKit safeAreaInsets.
 *  VoiceOver status is exposed as a separate opt-in hook so only screens that consume it subscribe. */
import { useVerticalBarEdgeIOS } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Platform, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { classifySurface, type SurfaceKind, surfaceTransitionDelayMs, type WindowMetrics } from './layout'
import type { VerticalBarEdge } from './vertical-bar'

export interface LiveSurfaceState {
  surface: SurfaceKind
  metrics: WindowMetrics
}

export function useLiveSurface(): LiveSurfaceState {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const verticalBarEdge = useVerticalBarEdge()
  const isPad = Platform.OS === 'ios' && Platform.isPad
  const metrics: WindowMetrics = {
    width,
    height,
    safeAreaLeft: insets.left,
    safeAreaRight: insets.right,
    safeAreaTop: insets.top,
    safeAreaBottom: insets.bottom,
    verticalBarEdge,
    isPad
  }
  const nextSurface = classifySurface(metrics)
  const [surface, setSurface] = useState<SurfaceKind>(nextSurface)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    const delay = surfaceTransitionDelayMs(surface, nextSurface, width, height)
    if (delay === null) return
    timer.current = setTimeout(() => setSurface(nextSurface), delay)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [width, height, nextSurface, surface])

  return { surface, metrics }
}

/** Tracks iOS VoiceOver state only for screens that adjust chrome visibility (e.g. compact Chat Back button). */
export function useScreenReaderEnabled(): boolean {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isScreenReaderEnabled().then(value => {
      if (active) setEnabled(value)
    })
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', value => setEnabled(value))
    return () => {
      active = false
      sub.remove()
    }
  }, [])

  return enabled
}

/** Tracks iOS 27.1+ `UITraitCollection.verticalBarEdge` via `expo-status-bar`.
 *  Returns `'leading'` or `'trailing'` when the system vertical bar is active (iPhone Duo),
 *  and `null` on iOS < 27.1, ordinary iPhones, iPads, Duo Unfolded Portrait, and non-iOS platforms. */
export function useVerticalBarEdge(): VerticalBarEdge {
  const edge = useVerticalBarEdgeIOS()
  if (Platform.OS !== 'ios') return null
  return edge === 'leading' || edge === 'trailing' ? edge : null
}
