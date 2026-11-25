/** Native pageSheet for answering a worker or delegated task's `needs_oscar` question directly from the dock or view.
 *  Pins Cancel/Send above the software keyboard, bounds multiline input height, guards single-send, and notices external answers. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Keyboard, Modal, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { messageOf } from '../../../shared/client/socket'
import type { WorkSummary } from '../../../shared/work-schema'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { duoSafeSheetPadding, THREAD_TYPE_CAPS } from './dock-pill'
import { answerInputMaxHeight } from './sheet-keyboard'
import { answerWork, useWaitingWork, useWorkLoaded } from './store'
import { useSheetKeyboard } from './use-sheet-keyboard'

export interface AnswerWorkSheetProps {
  work: WorkSummary | null
  title: string
  onClose: () => void
}

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

interface BodyProps {
  work: WorkSummary
  title: string
  busy: boolean
  busyRef: { current: boolean }
  showSeq: number
  setSending: (next: boolean) => void
  onClose: () => void
}

const ACTION_BTN = { minHeight: 44, borderRadius: radius.md, alignItems: 'center' as const, justifyContent: 'center' as const }

function AnswerWorkBody({ work, title, busy, busyRef, showSeq, setSending, onClose }: BodyProps) {
  const theme = useTheme()
  const pad = duoSafeSheetPadding(useSafeAreaInsets())
  const waitingWork = useWaitingWork()
  const workLoaded = useWorkLoaded()
  const { rootRef, measureSheet, keyboardOverlap, sheetHeight, fontScale } = useSheetKeyboard(showSeq)
  const [answer, setAnswer] = useState('')
  const [error, setError] = useState('')

  const inputMaxHeight = answerInputMaxHeight({ sheetHeight, keyboardOverlap, fontScale })
  const answeredElsewhere = workLoaded && !busy && !Object.values(waitingWork).some(item => item.id === work.id)
  const canSubmit = !busy && answer.trim().length > 0
  const hPad = { paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight }

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
      <View style={{ ...hPad, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        <AppText variant="title" numberOfLines={2} maxFontSizeMultiplier={THREAD_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
          {title}
        </AppText>
        {keyboardOverlap > 0 ? (
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

      <ScrollView testID="answer-work-scroll" style={{ flex: 1 }} alwaysBounceVertical keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled" contentContainerStyle={{ ...hPad, paddingVertical: 14, gap: 12 }}>
        {answeredElsewhere ? (
          <View testID="answer-work-stale-notice" style={{ borderRadius: radius.md, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, paddingHorizontal: 12, paddingVertical: 10 }}>
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={1.5}>
              Already answered on another device. Your draft is still here if you want to copy it.
            </AppText>
          </View>
        ) : null}
        <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground} maxFontSizeMultiplier={1.6}>
          {work.question || 'This task is waiting for your answer.'}
        </AppText>
        <TextInput
          testID="answer-work-input"
          value={answer}
          onChangeText={setAnswer}
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
            minHeight: 84,
            maxHeight: inputMaxHeight,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: theme.card,
            paddingHorizontal: 14,
            paddingVertical: 10,
            fontFamily: 'Inter_400Regular',
            fontSize: MOBILE_SCALE.chat.composerInput.fontSize,
            lineHeight: MOBILE_SCALE.chat.composerInput.lineHeight,
            color: theme.foreground
          }}
        />
        {error ? (
          <AppText testID="answer-work-error" variant="preview" color={theme.destructive} maxFontSizeMultiplier={1.5}>
            {error}
          </AppText>
        ) : null}
      </ScrollView>

      <View testID="answer-work-footer" style={{ ...hPad, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, paddingTop: 10, paddingBottom: keyboardOverlap > 0 ? keyboardOverlap + 10 : pad.paddingBottom, borderTopWidth: 1, borderTopColor: theme.hairline, backgroundColor: theme.background }}>
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
