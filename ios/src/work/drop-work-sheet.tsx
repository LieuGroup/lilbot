/** Confirmation pageSheet for dropping a work item with a required reason (`MOBILE_SCALE.work`, landscape-safe).
 *  Preserves typed draft with stale/reconnect notice if the item changes externally or mid-send, pins Cancel/Drop
 *  above the keyboard (including compact landscape heights), provides `Done`, and locks dismiss/submit while busy. */
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { messageOf } from '../../../shared/client/socket'
import { useConnectionStore } from '../connection/store'
import { type SheetWindowFrame, sheetKeyboardInset } from '../threads/sheet-keyboard'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { isConnectionLostError, isDroppableItem, runSingleSubmit, staleItemNotice } from './action-state'
import { dropSheetMetrics, WORK_TYPE_CAPS, workSheetPadding } from './board-state'
import { useWorkItem } from './store'
import { WorkNoticeBox } from './work-controls'

export interface DropWorkSheetProps {
  visible: boolean
  itemId: string
  title: string
  hasChildren: boolean
  onConfirm: (reason: string) => Promise<void>
  onClose: () => void
}

const BTN = { minHeight: 44, borderRadius: radius.md, alignItems: 'center' as const, justifyContent: 'center' as const }

export function DropWorkSheet({ visible, itemId, title, hasChildren, onConfirm, onClose }: DropWorkSheetProps) {
  const [busy, setBusy] = useState(false)
  const [showSeq, setShowSeq] = useState(0)
  const busyRef = useRef(false)
  const handleClose = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  useEffect(() => {
    if (visible) return
    busyRef.current = false
    setBusy(false)
  }, [visible])

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={handleClose} onShow={() => setShowSeq(n => n + 1)}>
      {visible ? <DropWorkSheetBody itemId={itemId} title={title} hasChildren={hasChildren} busy={busy} busyRef={busyRef} showSeq={showSeq} setBusy={setBusy} onConfirm={onConfirm} onClose={handleClose} /> : null}
    </Modal>
  )
}

type BodyProps = Omit<DropWorkSheetProps, 'visible'> & { busy: boolean; busyRef: { current: boolean }; showSeq: number; setBusy: (next: boolean) => void }

function DropWorkSheetBody({ itemId, title, hasChildren, busy, busyRef, showSeq, setBusy, onConfirm, onClose }: BodyProps) {
  const theme = useTheme()
  const pad = workSheetPadding(useSafeAreaInsets())
  const { height: windowHeight } = useWindowDimensions()
  const keyboardHeight = useKeyboardHeight(true)
  const connected = useConnectionStore(s => s.connected)
  const { item } = useWorkItem(itemId)
  const [sheetFrame, setSheetFrame] = useState<SheetWindowFrame | null>(null)
  const [scrollViewport, setScrollViewport] = useState(0)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [lostOnDisconnect, setLostOnDisconnect] = useState(false)
  const [reconnected, setReconnected] = useState(false)
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
  }, [showSeq, keyboardHeight, windowHeight, measureSheet])

  useEffect(() => {
    if (lostOnDisconnect && connected) setReconnected(true)
  }, [lostOnDisconnect, connected])

  const keyboardOverlap = sheetKeyboardInset(windowHeight, keyboardHeight, sheetFrame)
  const kbUp = keyboardOverlap > 0
  const sheetHeight = sheetFrame?.height && sheetFrame.height > 100 ? sheetFrame.height : windowHeight
  const metrics = dropSheetMetrics({ sheetHeight, keyboardOverlap, viewportHeight: scrollViewport })
  const droppable = item ? isDroppableItem(item) : true
  const notice = !busy ? staleItemNotice('drop', droppable, { afterReconnect: lostOnDisconnect && reconnected }) : null
  const canDrop = !busy && droppable && reason.trim().length > 0
  const hPad = { paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight }

  const keepInputVisible = useCallback(() => {
    if (kbUp) scrollRef.current?.scrollToEnd({ animated: false })
  }, [kbUp])

  useEffect(() => {
    const timer = setTimeout(() => (kbUp ? scrollRef.current?.scrollToEnd({ animated: false }) : scrollRef.current?.scrollTo({ y: 0, animated: false })), 30)
    return () => clearTimeout(timer)
  }, [kbUp, scrollViewport, error, notice])

  const submit = () =>
    runSingleSubmit(busyRef, async () => {
      const trimmed = reason.trim()
      if (!trimmed || !droppable) return
      setBusy(true)
      setError('')
      setLostOnDisconnect(false)
      setReconnected(false)
      try {
        await onConfirm(trimmed)
      } catch (failure) {
        const msg = messageOf(failure)
        if (isConnectionLostError(msg)) setLostOnDisconnect(true)
        setError(msg)
      } finally {
        setBusy(false)
      }
    })

  return (
    <View ref={rootRef} onLayout={measureSheet} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ ...hPad, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: metrics.compactLandscape ? 4 : kbUp ? 6 : 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.headerTitle} numberOfLines={1} style={[MOBILE_SCALE.work.cardTitle, { flex: 1, fontFamily: 'Inter_600SemiBold' }]}>
          Drop this item?
        </AppText>
        {kbUp ? (
          <Pressable testID="drop-keyboard-done" onPress={() => Keyboard.dismiss()} accessibilityRole="button" accessibilityLabel="Dismiss keyboard" style={({ pressed }) => ({ ...BTN, paddingHorizontal: 10, opacity: pressed ? 0.65 : 1 })}>
            <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground} style={[MOBILE_SCALE.work.button, { fontFamily: 'Inter_600SemiBold' }]}>
              Done
            </AppText>
          </Pressable>
        ) : null}
        <Pressable testID="drop-sheet-close" onPress={onClose} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.65 : 1 })}>
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} testID="drop-work-scroll" style={{ flex: 1 }} alwaysBounceVertical {...KEYBOARD_SCROLL_PROPS} onLayout={e => setScrollViewport(Math.round(e.nativeEvent.layout.height))} onContentSizeChange={keepInputVisible} contentContainerStyle={{ ...hPad, paddingVertical: metrics.compactLandscape ? 6 : kbUp ? 8 : 16, gap: metrics.compactLandscape ? 6 : kbUp ? 8 : 14 }}>
        {!metrics.compactLandscape ? (
          <AppText color={theme.foreground} numberOfLines={kbUp ? 1 : 3} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { fontFamily: 'Inter_500Medium' }]}>
            {title}
          </AppText>
        ) : null}
        {!kbUp ? (
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.rowMeta}>
            {hasChildren
              ? 'This item and all of its open parts will be dropped and the bots told. The record stays readable.'
              : 'The bot will be told why this item was dropped. The record stays readable.'}
          </AppText>
        ) : null}
        {notice ? <WorkNoticeBox testID="drop-work-stale-notice" message={notice} /> : null}
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
          maxFontSizeMultiplier={WORK_TYPE_CAPS.input}
          textAlignVertical="top"
          style={{ minHeight: metrics.minInputHeight, maxHeight: metrics.maxInputHeight, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.input, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: metrics.compactLandscape ? 6 : 8, fontFamily: 'Inter_400Regular', fontSize: MOBILE_SCALE.work.input.fontSize, lineHeight: MOBILE_SCALE.work.input.lineHeight, color: theme.foreground }}
        />
        {error ? <AppText testID="drop-work-error" color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{error}</AppText> : null}
      </ScrollView>

      <View testID="drop-work-footer" style={{ ...hPad, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, paddingTop: metrics.compactLandscape ? 6 : 10, paddingBottom: kbUp ? keyboardOverlap + (metrics.compactLandscape ? 6 : 10) : pad.paddingBottom, borderTopWidth: 1, borderTopColor: theme.hairline, backgroundColor: theme.background }}>
        <Pressable testID="drop-work-cancel" onPress={onClose} disabled={busy} accessibilityRole="button" style={({ pressed }) => ({ ...BTN, paddingHorizontal: 16, opacity: busy ? 0.45 : pressed ? 0.7 : 1 })}>
          <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground} style={MOBILE_SCALE.work.button}>Cancel</AppText>
        </Pressable>
        <Pressable testID="drop-work-confirm" onPress={() => void submit()} disabled={!canDrop} accessibilityRole="button" accessibilityState={{ disabled: !canDrop }} style={({ pressed }) => ({ ...BTN, paddingHorizontal: 18, backgroundColor: theme.destructive, opacity: !canDrop ? 0.45 : pressed ? 0.8 : 1 })}>
          <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color="#FFFFFF" style={[MOBILE_SCALE.work.button, { fontFamily: 'Inter_600SemiBold' }]}>
            {busy ? 'Dropping...' : 'Drop item'}
          </AppText>
        </Pressable>
      </View>
    </View>
  )
}
