/** Interactive "Needs you" banners on an item's page (`MOBILE_SCALE.work`):
 *  Oscar's Level 3 check (Pass / Send back) and question answer, preserving typed drafts on stale/reconnect. */
import { useRef, useState } from 'react'
import { Keyboard, useWindowDimensions, View } from 'react-native'
import { messageOf } from '../../../shared/client/socket'
import type { WorkItem } from '../../../shared/work-schema'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { isConnectionLostError, runSingleSubmit } from './action-state'
import { isCompactWorkHeight, shouldStackWorkActions, shouldStackWorkRow, WORK_TYPE_CAPS } from './board-state'
import { answerWorkItem, passWorkItem, sendBackWorkItem } from './store'
import { WorkButton, WorkInput, WorkNoticeBox } from './work-controls'

export interface OscarCheckBannerProps {
  item: WorkItem
  live: boolean
  reason: string
  sendingBack: boolean
  notice: string | null
  onReasonChange: (value: string) => void
  onSendingBackChange: (open: boolean) => void
  onConnectionLost: () => void
  onDismissNotice: () => void
  onInputFocus?: () => void
}

export function OscarCheckBanner(props: OscarCheckBannerProps) {
  const { item, live, reason, sendingBack, notice, onReasonChange, onSendingBackChange, onConnectionLost, onDismissNotice, onInputFocus } = props
  const theme = useTheme()
  const { fontScale, height } = useWindowDimensions()
  const stack = shouldStackWorkRow(fontScale)
  const inlineSendBack = isCompactWorkHeight(height)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')

  const runAction = (work: () => Promise<void>) =>
    runSingleSubmit(busyRef, async () => {
      if (!live) return
      setBusy(true)
      setError('')
      try {
        await work()
        Keyboard.dismiss()
        onDismissNotice()
      } catch (failure) {
        const msg = messageOf(failure)
        if (isConnectionLostError(msg)) onConnectionLost()
        setError(msg)
      } finally {
        setBusy(false)
      }
    })

  const pass = () => runAction(() => passWorkItem(item.id).then(() => {}))
  const sendBack = () => {
    const trimmed = reason.trim()
    if (!trimmed) return Promise.resolve({ ran: false })
    return runAction(async () => {
      await sendBackWorkItem(item.id, trimmed)
      onSendingBackChange(false)
      onReasonChange('')
    })
  }

  return (
    <View testID={`oscar-check-banner-${item.id}`} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: `${theme.primary}59`, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}>
      <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.cardTitle, { fontFamily: 'Inter_600SemiBold' }]}>
        Waits for your check · Level {item.checkLevel}
      </AppText>
      {item.result ? <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>{item.result}</AppText> : null}
      <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.rowMeta}>
        {item.question || 'Look at the evidence below, then pass it or send it back with a reason.'}
      </AppText>
      {notice ? <WorkNoticeBox testID={`work-check-stale-${item.id}`} message={notice} onDismiss={onDismissNotice} /> : null}

      {!sendingBack ? (
        <View style={{ flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'stretch' : 'center', gap: 8 }}>
          <WorkButton testID={`work-pass-${item.id}`} label={busy ? 'Passing...' : 'Pass'} disabled={busy || !live} onPress={() => void pass()} />
          <WorkButton
            testID={`work-send-back-start-${item.id}`}
            label="Send back"
            tone="secondary"
            disabled={busy || !live}
            onPress={() => {
              onSendingBackChange(true)
              onInputFocus?.()
            }}
          />
        </View>
      ) : (
        <View style={{ flexDirection: inlineSendBack ? 'row' : 'column', alignItems: inlineSendBack ? 'center' : 'stretch', gap: 8 }}>
          <WorkInput testID={`work-send-back-input-${item.id}`} value={reason} onChangeText={onReasonChange} onFocus={onInputFocus} placeholder="What needs fixing?" accessibilityLabel="What needs fixing?" editable={!busy} autoFocus={live} returnKeyType="send" submitBehavior="blurAndSubmit" onSubmitEditing={() => void sendBack()} style={{ flex: inlineSendBack ? 1 : undefined }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <WorkButton testID={`work-send-back-confirm-${item.id}`} label={busy ? 'Sending...' : 'Send back'} tone="destructive" disabled={!reason.trim() || busy || !live} onPress={() => void sendBack()} />
            <WorkButton label="Cancel" tone="ghost" disabled={busy} onPress={() => onSendingBackChange(false)} />
          </View>
        </View>
      )}
      {error ? <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{error}</AppText> : null}
    </View>
  )
}

export interface QuestionBannerProps {
  item: WorkItem
  live: boolean
  answer: string
  notice: string | null
  onAnswerChange: (value: string) => void
  onConnectionLost: () => void
  onDismissNotice: () => void
  onInputFocus?: () => void
}

export function QuestionBanner(props: QuestionBannerProps) {
  const { item, live, answer, notice, onAnswerChange, onConnectionLost, onDismissNotice, onInputFocus } = props
  const theme = useTheme()
  const { fontScale, width, height } = useWindowDimensions()
  const stack = shouldStackWorkActions(fontScale, { width, height })
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const [error, setError] = useState('')
  const canSend = live && !sending && answer.trim().length > 0

  const submit = () =>
    runSingleSubmit(sendingRef, async () => {
      const trimmed = answer.trim()
      if (!trimmed || !live) return
      setSending(true)
      setError('')
      try {
        await answerWorkItem(item.id, trimmed)
        Keyboard.dismiss()
        onAnswerChange('')
        onDismissNotice()
      } catch (failure) {
        const msg = messageOf(failure)
        if (isConnectionLostError(msg)) onConnectionLost()
        setError(msg)
      } finally {
        setSending(false)
      }
    })

  return (
    <View testID={`work-question-banner-${item.id}`} style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: `${theme.primary}59`, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}>
      <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.cardTitle, { fontFamily: 'Inter_600SemiBold' }]}>
        {item.ownerName} asks
      </AppText>
      {item.question ? <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>{item.question}</AppText> : null}
      {notice ? <WorkNoticeBox testID={`work-question-stale-${item.id}`} message={notice} onDismiss={onDismissNotice} /> : null}
      <View style={{ flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'stretch' : 'center', gap: 8 }}>
        <WorkInput testID={`work-answer-input-${item.id}`} value={answer} onChangeText={onAnswerChange} onFocus={onInputFocus} placeholder={`Answer ${item.ownerName}`} accessibilityLabel={`Answer ${item.ownerName}`} editable={!sending} returnKeyType="send" submitBehavior="blurAndSubmit" onSubmitEditing={() => void submit()} style={{ flex: stack ? undefined : 1 }} />
        <WorkButton testID={`work-answer-send-${item.id}`} label={sending ? 'Sending...' : 'Send'} disabled={!canSend} onPress={() => void submit()} />
      </View>
      {error ? <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{error}</AppText> : null}
    </View>
  )
}
