/** Live Duo/iPhone surface hook with ~150 ms fold-transition debounce, keyboard state, and Assistive Access / VoiceOver detection. */
import { useEffect, useRef, useState } from 'react'
import { AccessibilityInfo, Keyboard, Platform, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { classifySurface, isTransientDuoSize, type SurfaceKind, UNCONFIRMED_DUO_METRICS, type WindowMetrics } from './layout'

export interface LiveSurfaceState {
  surface: SurfaceKind
  metrics: WindowMetrics
  keyboardVisible: boolean
  assistiveAccess: boolean
}

export function useLiveSurface(): LiveSurfaceState {
  const { width, height } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const metrics: WindowMetrics = { width, height, safeAreaRight: insets.right, safeAreaTop: insets.top, safeAreaBottom: insets.bottom }
  const nextSurface = classifySurface(metrics)
  const [surface, setSurface] = useState<SurfaceKind>(nextSurface)
  const [keyboardVisible, setKeyboardVisible] = useState(false)
  const [assistiveAccess, setAssistiveAccess] = useState(false)
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

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const onShow = Keyboard.addListener(showEvent, () => setKeyboardVisible(true))
    const onHide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false))
    return () => {
      onShow.remove()
      onHide.remove()
    }
  }, [])

  useEffect(() => {
    let active = true
    void AccessibilityInfo.isScreenReaderEnabled().then(enabled => {
      if (active) setAssistiveAccess(enabled)
    })
    const sub = AccessibilityInfo.addEventListener('screenReaderChanged', enabled => setAssistiveAccess(enabled))
    return () => {
      active = false
      sub.remove()
    }
  }, [])

  return { surface, metrics, keyboardVisible, assistiveAccess }
}
