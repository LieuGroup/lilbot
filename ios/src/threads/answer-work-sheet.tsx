/** Native pageSheet for answering a worker or delegated task's `needs_oscar` question directly from the dock or view.
 *  Uses shared `useKeyboardHeight` + `KEYBOARD_SCROLL_PROPS`, pins Cancel/Send above the keyboard, sizes the multiline
 *  input to the measured viewport, keeps the active caret scrolled into view, guards single-send, and notices external answers. */
import { type ComponentRef, useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { messageOf } from '../../../shared/client/socket'
import type { WorkSummary } from '../../../shared/work-schema'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { duoSafeSheetPadding, THREAD_TYPE_CAPS } from './dock-pill'
import { answerInputMaxHeight, type SheetWindowFrame, sheetKeyboardInset } from './sheet-keyboard'
import { answerWork, useWaitingWork, useWorkLoaded } from './store'

export interface AnswerWorkSheetProps {
  work: WorkSummary | null
  title: string
  onClose: () => void
}

const ACTION_BTN = { minHeight: 44, borderRadius: radius.md, alignItems: 'center' as const, justifyContent: 'center' as const }

export function AnswerWorkSheet({ work, title, onClose }: AnswerWorkSheetProps) {
  const [busy, setBusy] = useState(false)
  const [showSeq, setShowSeq] = useState(0)
  const busyRef = useRef(false)
  const setSending = useCallback((next: boolean) => {
    busyRef.current = next
    setBusy(next)
  }, [])
  const handleClose = useCallback(() => {
    if (!busyRef.current) onClose()
  }, [onClose])

  useEffect(() => {
    if (work === null) setSending(false)
  }, [work, setSending])

  return (
    <Modal visible={work !== null} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal={!busy} onRequestClose={handleClose} onShow={() => setShowSeq(n => n + 1)}>
      {work ? <AnswerWorkBody key={work.id} work={work} title={title} busy={busy} busyRef={busyRef} showSeq={showSeq} setSending={setSending} onClose={handleClose} /> : null}
    </Modal>
  )
}

function AnswerWorkBody(props: { work: WorkSummary; title: string; busy: boolean; busyRef: { current: boolean }; showSeq: number; setSending: (next: boolean) => void; onClose: () => void }) {
  const { work, title, busy, busyRef, showSeq, setSending, onClose } = props
  const theme = useTheme()
  const pad = duoSafeSheetPadding(useSafeAreaInsets())
  const { height: windowHeight, fontScale } = useWindowDimensions()
  const keyboardHeight = useKeyboardHeight(true)
  const waitingWork = useWaitingWork()
  const workLoaded = useWorkLoaded()
  const [sheetFrame, setSheetFrame] = useState<SheetWindowFrame | null>(null)
  const [scrollViewport, setScrollViewport] = useState(0)
  const [answer, setAnswer] = useState('')
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
  const answeredElsewhere = workLoaded && !busy && !Object.values(waitingWork).some(item => item.id === work.id)
  const inputMaxHeight = answerInputMaxHeight({ viewportHeight: scrollViewport, sheetHeight, keyboardOverlap, fontScale, hasError: Boolean(error), hasNotice: answeredElsewhere })
  const canSubmit = !busy && answer.trim().length > 0
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
  }, [kbUp, scrollViewport, answeredElsewhere, error])

  const submit = async () => {
    if (busyRef.current) return
    const trimmed = answer.trim()
    if (!trimmed) return
    setSending(true)
    setError('')
    try {
      await answerWork(work.id, trimmed)
      setSending(false)
      onClose()
    } catch (failure) {
      setSending(false)
      setError(messageOf(failure))
    }
  }

  return (
    <View ref={rootRef} onLayout={measureSheet} style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ ...hPad, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: kbUp ? 6 : 10, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <AppText variant="title" numberOfLines={kbUp ? 1 : 2} maxFontSizeMultiplier={THREAD_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
          {title}
        </AppText>
        {kbUp ? (
          <Pressable testID="answer-keyboard-done" onPress={() => Keyboard.dismiss()} accessibilityRole="button" accessibilityLabel="Dismiss keyboard" style={({ pressed }) => ({ ...ACTION_BTN, paddingHorizontal: 10, opacity: pressed ? 0.65 : 1 })}>
            <AppText variant="name" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
              Done
            </AppText>
          </Pressable>
        ) : null}
        <Pressable testID="answer-sheet-close" onPress={onClose} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: busy ? 0.4 : pressed ? 0.65 : 1 })}>
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      <ScrollView ref={scrollRef} testID="answer-work-scroll" style={{ flex: 1 }} alwaysBounceVertical {...KEYBOARD_SCROLL_PROPS} onLayout={event => setScrollViewport(Math.round(event.nativeEvent.layout.height))} onContentSizeChange={keepInputVisible} contentContainerStyle={{ ...hPad, paddingVertical: kbUp ? 8 : 14, gap: kbUp ? 8 : 12 }}>
        <AppText testID="answer-work-question" style={MOBILE_SCALE.chat.message} color={theme.foreground} numberOfLines={kbUp ? 1 : undefined} maxFontSizeMultiplier={1.6}>
          {work.question || 'This task is waiting for your answer.'}
        </AppText>
        {answeredElsewhere ? (
          <View testID="answer-work-stale-notice" style={{ borderRadius: radius.md, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, paddingHorizontal: 10, paddingVertical: kbUp ? 6 : 10 }}>
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={1.35}>
              Already answered on another device. Your draft is still here if you want to copy it.
            </AppText>
          </View>
        ) : null}
        <TextInput
          testID="answer-work-input"
          value={answer}
          onChangeText={setAnswer}
          onFocus={keepInputVisible}
          onContentSizeChange={keepInputVisible}
          placeholder="Write your answer..."
          placeholderTextColor={theme.mutedForeground}
          accessibilityLabel="Your answer"
          editable={!busy}
          multiline
          scrollEnabled
          autoFocus
          maxFontSizeMultiplier={1.6}
          textAlignVertical="top"
          style={{
            minHeight: kbUp ? 76 : 84,
            maxHeight: inputMaxHeight,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: theme.card,
            paddingHorizontal: 14,
            paddingVertical: 8,
            fontFamily: 'Inter_400Regular',
            fontSize: MOBILE_SCALE.chat.composerInput.fontSize,
            lineHeight: MOBILE_SCALE.chat.composerInput.lineHeight,
            color: theme.foreground
          }}
        />
        {error ? (
          <AppText testID="answer-work-error" variant="preview" color={theme.destructive} maxFontSizeMultiplier={1.35}>
            {error}
          </AppText>
        ) : null}
      </ScrollView>

      <View testID="answer-work-footer" style={{ ...hPad, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, paddingTop: 10, paddingBottom: kbUp ? keyboardOverlap + 10 : pad.paddingBottom, borderTopWidth: 1, borderTopColor: theme.hairline, backgroundColor: theme.background }}>
        <Pressable testID="answer-work-cancel" onPress={onClose} disabled={busy} accessibilityRole="button" style={({ pressed }) => ({ ...ACTION_BTN, paddingHorizontal: 16, opacity: busy ? 0.45 : pressed ? 0.7 : 1 })}>
          <AppText variant="name" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.foreground}>
            Cancel
          </AppText>
        </Pressable>
        <Pressable testID="answer-work-submit" onPress={() => void submit()} disabled={!canSubmit} accessibilityRole="button" accessibilityState={{ disabled: !canSubmit }} style={({ pressed }) => ({ ...ACTION_BTN, paddingHorizontal: 18, backgroundColor: theme.foreground, opacity: !canSubmit ? 0.4 : pressed ? 0.8 : 1 })}>
          <AppText variant="name" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
            {busy ? 'Sending...' : 'Send answer'}
          </AppText>
        </Pressable>
      </View>
    </View>
  )
}
