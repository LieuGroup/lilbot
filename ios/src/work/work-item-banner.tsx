/** Top status banner of a work item's page across every state (`MOBILE_SCALE.work`, mirrors `web/src/work/work-item-banner.tsx`).
 *  Preserves in-progress question/send-back drafts and reports mid-send reconnect outcomes when `item` settles underneath. */
import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { checkerLabel, droppedByLine, elapsedShort, latestSettledCheck } from '../../../shared/client/work/work-lines'
import type { WorkItem } from '../../../shared/work-schema'
import { WorkingSpinner } from '../bots/status-marks'
import { useConnectionStore } from '../connection/store'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { isActionableOscarCheck, isActionableQuestion, resolveWorkItemActionState } from './action-state'
import { WORK_TYPE_CAPS } from './board-state'
import { OscarCheckBanner, QuestionBanner } from './work-item-actions'
import { DoneBanner, SentBackBanner } from './work-item-sections'

export function WorkItemBanner({ item, now, onInputFocus }: { item: WorkItem; now: number; onInputFocus?: () => void }) {
  const connected = useConnectionStore(s => s.connected)
  const [questionDraft, setQuestionDraft] = useState('')
  const [sendBackDraft, setSendBackDraft] = useState('')
  const [sendBackOpen, setSendBackOpen] = useState(false)
  const [lostKind, setLostKind] = useState<'question' | 'check' | null>(null)
  const [reconnected, setReconnected] = useState(false)

  useEffect(() => {
    if (lostKind && connected) setReconnected(true)
  }, [lostKind, connected])

  const actionState = resolveWorkItemActionState(item, { questionDraft, sendBackDraft, sendBackOpen, lostKind, reconnected })
  const questionLive = isActionableQuestion(item)
  const checkLive = isActionableOscarCheck(item)

  const clearQuestion = () => {
    setQuestionDraft('')
    setLostKind(null)
    setReconnected(false)
  }
  const clearCheck = () => {
    setSendBackDraft('')
    setSendBackOpen(false)
    setLostKind(null)
    setReconnected(false)
  }

  return (
    <View style={{ gap: 10 }}>
      {item.status === 'needs_oscar' ? null : <SettledStatusBanner item={item} now={now} />}
      {actionState.showQuestion ? (
        <QuestionBanner
          item={item}
          live={questionLive}
          answer={questionDraft}
          notice={actionState.notice}
          onAnswerChange={setQuestionDraft}
          onConnectionLost={() => {
            setLostKind('question')
            setReconnected(false)
          }}
          onDismissNotice={clearQuestion}
          onInputFocus={onInputFocus}
        />
      ) : null}
      {actionState.showCheck ? (
        <OscarCheckBanner
          item={item}
          live={checkLive}
          reason={sendBackDraft}
          sendingBack={sendBackOpen}
          notice={actionState.notice}
          onReasonChange={setSendBackDraft}
          onSendingBackChange={setSendBackOpen}
          onConnectionLost={() => {
            setLostKind('check')
            setReconnected(false)
          }}
          onDismissNotice={clearCheck}
          onInputFocus={onInputFocus}
        />
      ) : null}
    </View>
  )
}

function SettledStatusBanner({ item, now }: { item: WorkItem; now: number }) {
  const theme = useTheme()
  if (item.status === 'done') return <DoneBanner item={item} />

  if (item.status === 'checking') {
    const by = item.check ? checkerLabel(item.check, item.ownerName) : 'a second bot'
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.lg, backgroundColor: `${theme.primary}14`, paddingHorizontal: 14, paddingVertical: 12 }}>
        <WorkingSpinner color={theme.primary} size={14} />
        <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowMeta, { flex: 1, fontFamily: 'Inter_500Medium' }]}>
          Being checked by {by}{item.check?.model ? ` (${item.check.model.model})` : ''}
        </AppText>
      </View>
    )
  }

  if (item.status === 'failed') {
    return (
      <View style={{ gap: 6, borderRadius: radius.lg, backgroundColor: `${theme.destructive}14`, paddingHorizontal: 14, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CloseIcon color={theme.destructive} size={15} />
          <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.cardTitle, { fontFamily: 'Inter_600SemiBold' }]}>Failed</AppText>
        </View>
        {item.result ? <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>{item.result}</AppText> : null}
      </View>
    )
  }

  if (item.status === 'dropped') {
    return (
      <View style={{ borderRadius: radius.lg, backgroundColor: theme.muted, paddingHorizontal: 14, paddingVertical: 12 }}>
        <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={[MOBILE_SCALE.work.rowMeta, { fontFamily: 'Inter_500Medium' }]}>
          {droppedByLine(item)}
        </AppText>
      </View>
    )
  }

  const latest = latestSettledCheck(item.checks)
  if (latest?.state === 'sent_back') {
    return <SentBackBanner heading="Sent back by you" claimed={item.result} noteLabel="Your note: " note={latest.text} footer={`${item.ownerName} is working on it again.`} />
  }
  if (latest?.state === 'not_verified') {
    const failures = item.checks.filter(c => c.state === 'not_verified').length
    return (
      <SentBackBanner
        heading={`Not verified by ${checkerLabel(latest, item.ownerName)} · sent back ${failures === 1 ? 'once' : `${failures} times`}`}
        claimed={item.result}
        noteLabel="The checker saw: "
        note={latest.text}
        footer={`${item.ownerName} is working on it again. A second failure comes to you.`}
      />
    )
  }

  const label = item.status === 'working' ? 'Working' : 'Open'
  const since = item.startedAt ?? item.createdAt
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.lg, backgroundColor: theme.muted, paddingHorizontal: 14, paddingVertical: 12 }}>
      {item.status === 'working' ? <WorkingSpinner color={theme.primary} size={14} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.mutedForeground }} />}
      <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={[MOBILE_SCALE.work.rowMeta, { fontFamily: 'Inter_500Medium' }]}>
        {label} · {elapsedShort(now - since)}
      </AppText>
    </View>
  )
}
