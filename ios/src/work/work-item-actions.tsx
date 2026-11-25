/** Interactive "Needs you" banners on an item's page: Oscar's Level 3 check (Pass / Send back) and question answer. */
import { useState } from 'react'
import { useWindowDimensions, View } from 'react-native'
import { messageOf } from '../../../shared/client/socket'
import type { WorkItem } from '../../../shared/work-schema'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { shouldStackWorkRow } from './board-state'
import { answerWorkItem, passWorkItem, sendBackWorkItem } from './store'
import { WorkButton, WorkInput } from './work-controls'

export function OscarCheckBanner({ item }: { item: WorkItem }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stack = shouldStackWorkRow(fontScale)
  const [sendingBack, setSendingBack] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const pass = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await passWorkItem(item.id)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const sendBack = async () => {
    const trimmed = reason.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError('')
    try {
      await sendBackWorkItem(item.id, trimmed)
      setSendingBack(false)
      setReason('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View
      testID={`oscar-check-banner-${item.id}`}
      style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: `${theme.primary}59`, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}
    >
      <AppText variant="preview" color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
        Waits for your check · Level {item.checkLevel}
      </AppText>
      {item.result ? (
        <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>
          {item.result}
        </AppText>
      ) : null}
      <AppText variant="preview" color={theme.mutedForeground}>
        {item.question || 'Look at the evidence below, then pass it or send it back with a reason.'}
      </AppText>

      {!sendingBack ? (
        <View style={{ flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'stretch' : 'center', gap: 8 }}>
          <WorkButton testID={`work-pass-${item.id}`} label={busy ? 'Passing...' : 'Pass'} disabled={busy} onPress={() => void pass()} />
          <WorkButton testID={`work-send-back-start-${item.id}`} label="Send back" tone="secondary" disabled={busy} onPress={() => setSendingBack(true)} />
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <WorkInput
            testID={`work-send-back-input-${item.id}`}
            value={reason}
            onChangeText={setReason}
            placeholder="What needs fixing?"
            accessibilityLabel="What needs fixing?"
            editable={!busy}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={() => void sendBack()}
          />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <WorkButton testID={`work-send-back-confirm-${item.id}`} label={busy ? 'Sending...' : 'Send back'} tone="destructive" disabled={!reason.trim() || busy} onPress={() => void sendBack()} />
            <WorkButton label="Cancel" tone="ghost" disabled={busy} onPress={() => setSendingBack(false)} />
          </View>
        </View>
      )}

      {error ? (
        <AppText variant="preview" color={theme.destructive}>
          {error}
        </AppText>
      ) : null}
    </View>
  )
}

export function QuestionBanner({ item }: { item: WorkItem }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stack = shouldStackWorkRow(fontScale)
  const [answer, setAnswer] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const canSend = !sending && answer.trim().length > 0

  const submit = async () => {
    const trimmed = answer.trim()
    if (!trimmed || sending) return
    setSending(true)
    setError('')
    try {
      await answerWorkItem(item.id, trimmed)
      setAnswer('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setSending(false)
    }
  }

  return (
    <View
      testID={`work-question-banner-${item.id}`}
      style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: `${theme.primary}59`, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}
    >
      <AppText variant="preview" color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
        {item.ownerName} asks
      </AppText>
      {item.question ? (
        <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>
          {item.question}
        </AppText>
      ) : null}
      <View style={{ flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'stretch' : 'center', gap: 8 }}>
        <WorkInput
          testID={`work-answer-input-${item.id}`}
          value={answer}
          onChangeText={setAnswer}
          placeholder={`Answer ${item.ownerName}`}
          accessibilityLabel={`Answer ${item.ownerName}`}
          editable={!sending}
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
          style={{ flex: stack ? undefined : 1 }}
        />
        <WorkButton testID={`work-answer-send-${item.id}`} label={sending ? 'Sending...' : 'Send'} disabled={!canSend} onPress={() => void submit()} />
      </View>
      {error ? (
        <AppText variant="preview" color={theme.destructive}>
          {error}
        </AppText>
      ) : null}
    </View>
  )
}
