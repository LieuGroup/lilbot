/** Live software-keyboard overlap height hook and shared ScrollView/FlatList keyboard props. */
import { useEffect, useState } from 'react'
import { Keyboard, type KeyboardEvent, Platform, useWindowDimensions } from 'react-native'
import { keyboardOverlapHeight } from './keyboard-sheet'

/** Standard keyboard interaction for sheets and search lists: drag drops the keyboard, tapping an item works immediately. */
export const KEYBOARD_SCROLL_PROPS = {
  keyboardDismissMode: 'on-drag' as const,
  keyboardShouldPersistTaps: 'handled' as const
}

/** Tracks the live height of the software keyboard overlapping the bottom of the current window. */
export function useKeyboardHeight(active = true): number {
  const { height: windowHeight } = useWindowDimensions()
  const [height, setHeight] = useState(0)

  useEffect(() => {
    if (!active) {
      setHeight(0)
      return
    }
    const update = (event: KeyboardEvent) => {
      setHeight(keyboardOverlapHeight(windowHeight, event.endCoordinates))
    }
    const clear = () => setHeight(0)
    setHeight(Keyboard.isVisible() ? keyboardOverlapHeight(windowHeight, Keyboard.metrics()) : 0)

    const subs =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', update),
            Keyboard.addListener('keyboardWillShow', update),
            Keyboard.addListener('keyboardDidShow', update),
            Keyboard.addListener('keyboardWillHide', clear),
            Keyboard.addListener('keyboardDidHide', clear)
          ]
        : [Keyboard.addListener('keyboardDidShow', update), Keyboard.addListener('keyboardDidHide', clear)]

    return () => {
      for (const sub of subs) sub.remove()
    }
  }, [active, windowHeight])

  return height
}
