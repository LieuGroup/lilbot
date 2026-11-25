/** Native pageSheet for answering a worker or delegated task's `needs_oscar` question directly from the dock or view.
 *  Applies Duo-safe horizontal insets so Folded Duo's trailing rail/clock never overlap controls. */
import { useState } from 'react'
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { messageOf } from '../../../shared/client/socket'
import type { WorkSummary } from '../../../shared/work-schema'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { duoSafeSheetPadding, THREAD_TYPE_CAPS } from './dock-pill'
import { answerWork } from './store'

export interface AnswerWorkSheetProps {
  work: WorkSummary | null
  title: string
  onClose: () => void
}

export function AnswerWorkSheet({ work, title, onClose }: AnswerWorkSheetProps) {
  return (
    <Modal visible={work !== null} animationType="slide" presentationStyle="pageSheet" allowSwipeDismissal onRequestClose={onClose}>
      {work ? <AnswerWorkBody work={work} title={title} onClose={onClose} /> : null}
    </Modal>
  )
}

function AnswerWorkBody({ work, title, onClose }: { work: WorkSummary; title: string; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const pad = duoSafeSheetPadding(insets)
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const canSubmit = !sending && answer.trim().length > 0

  const submit = async () => {
    const trimmed = answer.trim()
    if (sending || !trimmed) return
    setSending(true)
    setError('')
    try {
      await answerWork(work.id, trimmed)
      onClose()
    } catch (failure) {
      setError(messageOf(failure))
      setSending(false)
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          paddingLeft: pad.paddingLeft,
          paddingRight: pad.paddingRight,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: theme.hairline
        }}
      >
        <AppText variant="title" numberOfLines={2} maxFontSizeMultiplier={THREAD_TYPE_CAPS.headerTitle} style={{ flex: 1 }}>
          {title}
        </AppText>
        <Pressable
          testID="answer-sheet-close"
          onPress={onClose}
          disabled={sending}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', opacity: sending ? 0.4 : pressed ? 0.65 : 1 })}
        >
          <CloseIcon color={theme.foreground} size={16} />
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingLeft: pad.paddingLeft,
          paddingRight: pad.paddingRight,
          paddingTop: 16,
          paddingBottom: pad.paddingBottom,
          gap: 14
        }}
      >
        <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>
          {work.question || 'This task is waiting for your answer.'}
        </AppText>
        <TextInput
          testID="answer-work-input"
          value={answer}
          onChangeText={setAnswer}
          placeholder="Write your answer..."
          placeholderTextColor={theme.mutedForeground}
          accessibilityLabel="Your answer"
          editable={!sending}
          multiline
          autoFocus
          textAlignVertical="top"
          style={{
            minHeight: 112,
            borderRadius: radius.lg,
            borderWidth: 1,
            borderColor: theme.input,
            backgroundColor: theme.card,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontFamily: 'Inter_400Regular',
            fontSize: MOBILE_SCALE.chat.composerInput.fontSize,
            lineHeight: MOBILE_SCALE.chat.composerInput.lineHeight,
            color: theme.foreground
          }}
        />
        {error ? (
          <AppText variant="preview" color={theme.destructive}>
            {error}
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10 }}>
          <Pressable
            testID="answer-work-cancel"
            onPress={onClose}
            disabled={sending}
            accessibilityRole="button"
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 16,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: sending ? 0.45 : pressed ? 0.7 : 1
            })}
          >
            <AppText variant="name" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.foreground}>
              Cancel
            </AppText>
          </Pressable>
          <Pressable
            testID="answer-work-submit"
            onPress={() => void submit()}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            style={({ pressed }) => ({
              minHeight: 44,
              paddingHorizontal: 18,
              borderRadius: radius.md,
              backgroundColor: theme.foreground,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: !canSubmit ? 0.4 : pressed ? 0.8 : 1
            })}
          >
            <AppText variant="name" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
              {sending ? 'Sending...' : 'Send answer'}
            </AppText>
          </Pressable>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  )
}
