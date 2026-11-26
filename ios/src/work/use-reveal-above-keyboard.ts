/** Keeps the focused Work card or banner (its input and action buttons) visible just above the keyboard Done bar,
 *  and reports the keyboard height only to the pane whose field has focus so an iPad split shows one Done bar.
 *  In iPhone landscape the strip above the keyboard is shorter than a card, so the card's bottom is aligned rather than its top. */
import { type ComponentRef, useCallback, useEffect, useId, useRef } from 'react'
import { type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, useWindowDimensions, type View } from 'react-native'
import { create } from 'zustand'
import { revealScrollTarget, WORK_DONE_BAR_HEIGHT } from './board-state'

export type RevealTarget = ComponentRef<typeof View>

const useFocusedPane = create<{ paneId: string | null }>(() => ({ paneId: null }))

export function useRevealAboveKeyboard(keyboardHeight: number) {
  const { height: windowHeight } = useWindowDimensions()
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null)
  const offset = useRef(0)
  const target = useRef<RevealTarget | null>(null)
  const paneId = useId()
  const focusedHere = useFocusedPane(state => state.paneId === paneId)

  const revealNow = useCallback(() => {
    const node = target.current
    if (!node || keyboardHeight <= 0) return
    node.measureInWindow((_x: number, y: number, _w: number, height: number) => {
      const next = revealScrollTarget({ offset: offset.current, targetY: y, targetHeight: height, visibleBottom: windowHeight - keyboardHeight - WORK_DONE_BAR_HEIGHT })
      if (next !== null) scrollRef.current?.scrollTo({ y: next, animated: true })
    })
  }, [keyboardHeight, windowHeight])

  useEffect(() => {
    if (keyboardHeight <= 0) return
    const handle = setTimeout(revealNow, 60)
    return () => clearTimeout(handle)
  }, [keyboardHeight, revealNow])

  const reveal = useCallback(
    (node: RevealTarget | null) => {
      target.current = node
      useFocusedPane.setState({ paneId })
      setTimeout(revealNow, 80)
    },
    [paneId, revealNow]
  )

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y
  }, [])

  return { scrollRef, onScroll, reveal, doneBarHeight: focusedHere ? keyboardHeight : 0 }
}
