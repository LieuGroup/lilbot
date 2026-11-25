/** Confirmation pageSheet for dropping a work item with a required reason (mirrors `web/src/work/drop-work-dialog.tsx`).
 *  Uses shared `useKeyboardHeight` + `KEYBOARD_SCROLL_PROPS`, pins Cancel/Drop above keyboard, provides `Done`,
 *  and locks dismiss and duplicate submits while dropping. */
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { messageOf } from '../../../shared/client/socket'
import { answerInputMaxHeight, type SheetWindowFrame, sheetKeyboardInset } from '../threads/sheet-keyboard'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { WORK_TYPE_CAPS, workSheetPadding } from './board-state'

export interface DropWorkSheetProps {
  visible: boolean
  title: string
  hasChildren: boolean
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}

const ACTION_BTN = { minHeight: 44, borderRadius: radius.md, alignItems: 'center' as const, justifyContent: 'center' as const }

export function DropWorkSheet({ visible, title, hasChildren, onConfirm, onClose }: DropWorkSheetProps) {
  const [busy, setBusy] = useState(false)
  const [showSeq, setShowSeq] = useState(0)
  const busyRef = useRef(false)
  const setDropping = useCallback((next: boolean) => {
    busyRef.current = next
    setBusy(next)
  }, [])
  const handleClose = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  useEffect(() => {
    if (!visible) setDropping(false)
  }, [visible, setDropping])

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={handleClose} onShow={() => setShowSeq(n => n + 1)}>
      {visible ? <DropWorkSheetBody title={title} hasChildren={hasChildren} busy={busy} busyRef={busyRef} showSeq={showSeq} setDropping={setDropping} onConfirm={onConfirm} onClose={handleClose} /> : null}
    </Modal>
  )
}

function DropWorkSheetBody(props: {
  title: string
  hasChildren: boolean
  busy: boolean
  busyRef: { current: boolean }
  showSeq: number
  setDropping: (next: boolean) => void
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}) {
  const { title, hasChildren, busy, busyRef, showSeq, setDropping, onConfirm, onClose } = props
  const theme = useTheme()
  const pad = workSheetPadding(useSafeAreaInsets())
  const { height: windowHeight, fontScale } = useWindowDimensions()
  const keyboardHeight = useKeyboardHeight(true)
  const [sheetFrame, setSheetFrame] = useState<SheetWindowFrame | null>(null)
  const [scrollViewport, setScrollViewport] = useState(0)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const rootRef = useRef<ComponentRef<typeof View>>(null)
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null)

  const measureSheet = useCallback(() => {
    rootRef.current?.measureInWindow((_x: number, y: number, _w: number, height: number) => {
      if (height > 0) setSheetFrame(prev => (prev && Math.abs(prev.y - y) < 1 && Math.abs(prev.height - height) < 1 ? prev : { y, height }))
    })
  }, [])

  useEffect(() => {
    const t1 = setTimeout(measureSheet, 80)
    const t2 = setTimeout(measureSheet, 320)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [showSeq, keyboardHeight, measureSheet])

  const keyboardOverlap = sheetKeyboardInset(windowHeight, keyboardHeight, sheetFrame)
  const kbUp = keyboardOverlap > 0
  const sheetHeight = sheetFrame?.height && sheetFrame.height > 100 ? sheetFrame.height : windowHeight
  const inputMaxHeight = answerInputMaxHeight({ viewportHeight: scrollViewport, sheetHeight, keyboardOverlap, fontScale, hasError: Boolean(error) })
  const canDrop = !busy && reason.trim().length > 0
  const hPad = { paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight }

  const keepInputVisible = useCallback(() => {
    if (kbUp) scrollRef.current?.scrollToEnd({ animated: false })
  }, [kbUp])

  useEffect(() => {
    const timer = setTimeout(() => {
      if (kbUp) scrollRef.current?.scrollToEnd({ animated: false })
      else scrollRef.current?.scrollTo({ y: 0, animated: false })
    }, 30)
    return () => clearTimeout(timer)
  }, [kbUp, scrollViewport, error])

  const submit = async () => {
    if (busyRef.current) return
    const trimmed = reason.trim()
    if (!trimmed) return
    setDropping(true)
    setError('')
    try {
      await onConfirm(trimmed)
      setDropping(false)
    } catch (failure) {
      setDropping(false)
      setError(messageOf(failure))
    }
  }

  return (
    <View ref={rootRef} onLayout={measureSheet} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ ...hPad, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: kbUp ? 6 : 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <AppText variant="title" numberOfLines={1} maxFontSizeMultiplier={WORK_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
          Drop this item?
        </AppText>
        {kbUp ? (
          <Pressable testID="drop-keyboard-done" onPress={() => Keyboard.dismiss()} accessibilityRole="button" accessibilityLabel="Dismiss keyboard" style={({ pressed }) => ({ ...ACTION_BTN, paddingHorizontal: 10, opacity: pressed ? 0.65 : 1 })}>
            <AppText variant="name" maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
              Done
            </AppText>
          </Pressable>
        ) : null}
        <Pressable testID="drop-sheet-close" onPress={onClose} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.65 : 1 })}>
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} testID="drop-work-scroll" style={{ flex: 1 }} alwaysBounceVertical {...KEYBOARD_SCROLL_PROPS} onLayout={event => setScrollViewport(Math.round(event.nativeEvent.layout.height))} onContentSizeChange={keepInputVisible} contentContainerStyle={{ ...hPad, paddingVertical: kbUp ? 8 : 16, gap: kbUp ? 8 : 14 }}>
        <AppText variant="chat" color={theme.foreground} numberOfLines={kbUp ? 1 : 3} maxFontSizeMultiplier={1.6} style={{ fontFamily: 'Inter_500Medium' }}>
          {title}
        </AppText>
        {!kbUp ? (
          <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={1.5}>
            {hasChildren
              ? 'This item and all of its open parts will be dropped and the bots told. The record stays readable.'
              : 'The bot will be told why this item was dropped. The record stays readable.'}
          </AppText>
        ) : null}
        <TextInput
          testID="drop-work-reason"
          value={reason}
          onChangeText={setReason}
          onFocus={keepInputVisible}
          onContentSizeChange={keepInputVisible}
          placeholder="Why are you dropping it?"
          placeholderTextColor={theme.mutedForeground}
          accessibilityLabel="Reason for dropping"
          editable={!busy}
          multiline
          scrollEnabled
          autoFocus
          maxFontSizeMultiplier={1.6}
          textAlignVertical="top"
          style={{
            minHeight: kbUp ? 76 : 88,
            maxHeight: inputMaxHeight,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: theme.card,
            paddingHorizontal: 14,
            paddingVertical: 8,
            fontFamily: 'Inter_400Regular',
            fontSize: 15,
            lineHeight: 22,
            color: theme.foreground
          }}
        />
        {error ? (
          <AppText testID="drop-work-error" variant="preview" color={theme.destructive} maxFontSizeMultiplier={1.35}>
            {error}
          </AppText>
        ) : null}
      </ScrollView>

      <View testID="drop-work-footer" style={{ ...hPad, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, paddingTop: 10, paddingBottom: kbUp ? keyboardOverlap + 10 : pad.paddingBottom, borderTopWidth: 1, borderTopColor: theme.hairline, backgroundColor: theme.background }}>
        <Pressable testID="drop-work-cancel" onPress={onClose} disabled={busy} accessibilityRole="button" style={({ pressed }) => ({ ...ACTION_BTN, paddingHorizontal: 16, opacity: busy ? 0.45 : pressed ? 0.7 : 1 })}>
          <AppText variant="name" maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground}>
            Cancel
          </AppText>
        </Pressable>
        <Pressable testID="drop-work-confirm" onPress={() => void submit()} disabled={!canDrop} accessibilityRole="button" accessibilityState={{ disabled: !canDrop }} style={({ pressed }) => ({ ...ACTION_BTN, paddingHorizontal: 18, backgroundColor: theme.destructive, opacity: !canDrop ? 0.45 : pressed ? 0.8 : 1 })}>
          <AppText variant="name" maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color="#FFFFFF" style={{ fontFamily: 'Inter_600SemiBold' }}>
            {busy ? 'Dropping...' : 'Drop item'}
          </AppText>
        </Pressable>
      </View>
    </View>
  )
}
