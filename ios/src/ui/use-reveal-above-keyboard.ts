/** Keeps the focused field or card visible just above the keyboard bar on scrollable screens and forms (Work, Bot Details
 *  Setup, Settings server address, rename device), and reports the keyboard only to the pane whose field has focus so a
 *  split shows one bar. Every distance is measured in window points: the scroll area's own frame, the focused node, and
 *  the keyboard, so a screen that ends above the window bottom still lines up. In iPhone landscape the strip above the
 *  keyboard is shorter than a card, so the bottom is aligned; a focused multiline field is capped to fit instead. */
import { type ComponentRef, useCallback, useEffect, useId, useRef, useState } from 'react'
import { type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, TextInput, useWindowDimensions, type View } from 'react-native'
import { create } from 'zustand'
import { collapseHeaderWhileTyping, focusedFieldMaxHeight, KEYBOARD_BAR_HEIGHT, revealScrollTarget } from './keyboard-sheet'

export type RevealTarget = ComponentRef<typeof View>

/** What a form passes to each of its text inputs: focus handlers, and a height cap for a focused multiline field. */
export interface FormFieldFocus {
  onFocus: () => void
  onBlur: () => void
  maxHeight?: number
}
type Measurable = { measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void }

const useFocusedPane = create<{ paneId: string | null }>(() => ({ paneId: null }))

/** True while a form field that uses this helper has focus and the window above the keyboard is short (iPhone and Duo
 *  landscape): screens fold their own header and navigation bar then, so the field being typed in has room. */
export function useFoldChromeWhileTyping(keyboardHeight: number): boolean {
  const { height } = useWindowDimensions()
  const focused = useFocusedPane(state => state.paneId !== null)
  return focused && collapseHeaderWhileTyping(height, keyboardHeight)
}

export function useRevealAboveKeyboard(keyboardHeight: number, options: { barHeight?: number } = {}) {
  const barHeight = options.barHeight ?? KEYBOARD_BAR_HEIGHT
  const { height: windowHeight } = useWindowDimensions()
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null)
  const offset = useRef(0)
  const target = useRef<Measurable | null>(null)
  const paneId = useId()
  const focusedHere = useFocusedPane(state => state.paneId === paneId)
  const [frame, setFrame] = useState({ top: 0, bottom: windowHeight })

  const revealNow = useCallback(() => {
    const scroll = scrollRef.current as unknown as Measurable | null
    const node = target.current ?? (TextInput.State.currentlyFocusedInput() as unknown as Measurable | null)
    if (!scroll || !node || keyboardHeight <= 0 || useFocusedPane.getState().paneId !== paneId) return
    scroll.measureInWindow((_x, top, _width, height) => {
      setFrame(prev => (prev.top === top && prev.bottom === top + height ? prev : { top, bottom: top + height }))
      const visibleBottom = Math.min(top + height, windowHeight - keyboardHeight) - barHeight
      node.measureInWindow((_nx, y, _nw, nodeHeight) => {
        const next = revealScrollTarget({ offset: offset.current, targetY: y, targetHeight: nodeHeight, visibleBottom, visibleTop: top })
        if (next !== null) scrollRef.current?.scrollTo({ y: next, animated: true })
      })
    })
  }, [barHeight, keyboardHeight, paneId, windowHeight])

  useEffect(() => {
    if (keyboardHeight <= 0 || !focusedHere) return
    const handle = setTimeout(revealNow, 60)
    return () => clearTimeout(handle)
  }, [focusedHere, keyboardHeight, revealNow])

  /** The scroll area moved or resized, or its content grew to make room (a header folded, the window rotated, the
   *  keyboard padding arrived): line the focused field up again, since an earlier scroll may have been clamped. */
  const onLayout = useCallback(() => {
    if (keyboardHeight > 0) setTimeout(revealNow, 40)
  }, [keyboardHeight, revealNow])

  /** A card or banner whose input and buttons should all show (Work, the rename card). */
  const reveal = useCallback(
    (node: RevealTarget | null) => {
      target.current = node as unknown as Measurable | null
      useFocusedPane.setState({ paneId })
      setTimeout(revealNow, 80)
    },
    [paneId, revealNow]
  )

  /** A form field: the text input that has focus is measured, so one handler serves every field on the screen. */
  const onFieldFocus = useCallback(() => {
    target.current = null
    useFocusedPane.setState({ paneId })
    setTimeout(revealNow, 80)
  }, [paneId, revealNow])

  const onFieldBlur = useCallback(() => {
    if (useFocusedPane.getState().paneId === paneId) useFocusedPane.setState({ paneId: null })
  }, [paneId])

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = event.nativeEvent.contentOffset.y
  }, [])

  const typing = focusedHere && keyboardHeight > 0
  const visibleBottom = Math.min(frame.bottom, windowHeight - keyboardHeight) - barHeight
  return {
    scrollRef,
    onScroll,
    onLayout,
    onContentSizeChange: onLayout,
    reveal,
    onFieldFocus,
    onFieldBlur,
    typing,
    /** Extra bottom padding for the scroll content while typing, so the last field can scroll clear of keyboard and bar. */
    contentBottom: typing ? Math.round(keyboardHeight + barHeight) : 0,
    /** Bottom offset for the keyboard bar inside the scroll area's container; 0 while this pane has no focused field. */
    doneBarHeight: typing ? Math.max(1, Math.round(keyboardHeight - (windowHeight - frame.bottom))) : 0,
    /** Height cap for a focused multiline field so its caret line stays between the scroll top and the keyboard bar. */
    fieldMaxHeight: typing ? focusedFieldMaxHeight({ scrollTop: frame.top, visibleBottom }) : undefined
  }
}
