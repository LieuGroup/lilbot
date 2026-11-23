/** Live Duo/iPhone surface hook with ~150 ms fold-transition debounce, trusting live UIKit safeAreaInsets.
 *  VoiceOver status is exposed as a separate opt-in hook so only screens that consume it subscribe. */
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { classifySurface, isTransientDuoSize, type SurfaceKind, UNCONFIRMED_DUO_METRICS, type WindowMetrics } from './layout'

export interface LiveSurfaceState {
  surface: SurfaceKind
  metrics: WindowMetrics
}

export function useLiveSurface(): LiveSurfaceState {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const metrics: WindowMetrics = { width, height, safeAreaRight: insets.right, safeAreaTop: insets.top, safeAreaBottom: insets.bottom }
  const nextSurface = classifySurface(metrics)
  const [surface, setSurface] = useState<SurfaceKind>(nextSurface)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    // Hold the last stable surface while the hinge passes through transient intermediate sizes.
    if (isTransientDuoSize(width, height)) return
    if (nextSurface === surface) return
    timer.current = setTimeout(() => setSurface(nextSurface), UNCONFIRMED_DUO_METRICS.transitionDebounceMs)
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
