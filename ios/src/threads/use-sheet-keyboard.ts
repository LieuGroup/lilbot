/** Live pageSheet keyboard overlap hook (mirrors PR #307's `useKeyboardHeight` plus `measureInWindow` sheet framing). */
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, type KeyboardEvent, Platform, useWindowDimensions, type View } from 'react-native'
import { type KeyboardRect, type SheetWindowFrame, sheetKeyboardOverlap } from './sheet-keyboard'

export function useSheetKeyboard(showSeq: number) {
  const { height: windowHeight, fontScale } = useWindowDimensions()
  const [sheetFrame, setSheetFrame] = useState<SheetWindowFrame | null>(null)
  const [kbCoords, setKbCoords] = useState<KeyboardRect | null>(null)
  const rootRef = useRef<ComponentRef<typeof View>>(null)

  const measureSheet = useCallback(() => {
    rootRef.current?.measureInWindow((_x: number, y: number, _w: number, height: number) => {
      if (height > 0) setSheetFrame(prev => (prev && Math.abs(prev.y - y) < 1 && Math.abs(prev.height - height) < 1 ? prev : { y, height }))
    })
  }, [])

  useEffect(() => {
    const timer = setTimeout(measureSheet, 80)
    return () => clearTimeout(timer)
  }, [showSeq, measureSheet])

  useEffect(() => {
    const onShow = (event: KeyboardEvent) => {
      measureSheet()
      setKbCoords(event.endCoordinates)
    }
    const onHide = () => setKbCoords(null)
    const subs =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillChangeFrame', onShow),
            Keyboard.addListener('keyboardWillShow', onShow),
            Keyboard.addListener('keyboardDidShow', onShow),
            Keyboard.addListener('keyboardWillHide', onHide),
            Keyboard.addListener('keyboardDidHide', onHide)
          ]
        : [Keyboard.addListener('keyboardDidShow', onShow), Keyboard.addListener('keyboardDidHide', onHide)]
    return () => {
      for (const sub of subs) sub.remove()
    }
  }, [measureSheet])

  const keyboardOverlap = sheetKeyboardOverlap(windowHeight, kbCoords, sheetFrame)
  const sheetHeight = sheetFrame?.height && sheetFrame.height > 100 ? sheetFrame.height : windowHeight
  return { rootRef, measureSheet, keyboardOverlap, sheetHeight, fontScale }
}
