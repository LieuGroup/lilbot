/** "Needs you" cards on Today's brief (`MOBILE_SCALE.work`, mirrors `web/src/work/needs-you-card.tsx`):
 *  inline answer form for bot questions (preserving draft on stale/reconnect) and `Look` button for Oscar checks. */
import { useEffect, useRef, useState } from 'react'
import { Keyboard, Pressable, useWindowDimensions, View } from 'react-native'
import { messageOf } from '../../../shared/client/socket'
import { elapsedShort, isOscarCheck } from '../../../shared/client/work/work-lines'
import type { WorkSummary } from '../../../shared/work-schema'
import { useConnectionStore } from '../connection/store'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { isConnectionLostError, runSingleSubmit, staleItemNotice } from './action-state'
import { shouldStackWorkRow, WORK_TYPE_CAPS } from './board-state'
import { answerWorkItem } from './store'
import { WorkAvatar } from './work-avatar'
import { WorkButton, WorkInput, WorkNoticeBox } from './work-controls'

export interface NeedsYouWorkCardProps {
  item: WorkSummary
  now: number
  live?: boolean
  lostOnDisconnect?: boolean
  onOpenItem: (itemId: string) => void
  onDraftChange?: (item: WorkSummary, draft: string, lost: boolean) => void
  onDismissStale?: (itemId: string) => void
  onInputFocus?: () => void
}

export function NeedsYouWorkCard(props: NeedsYouWorkCardProps) {
  if (isOscarCheck(props.item)) return <OscarCheckCard item={props.item} onOpenItem={props.onOpenItem} />
  return <QuestionCard {...props} />
}

function QuestionCard({ item, now, live = true, lostOnDisconnect = false, onOpenItem, onDraftChange, onDismissStale, onInputFocus }: NeedsYouWorkCardProps) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const connected = useConnectionStore(s => s.connected)
  const stack = shouldStackWorkRow(fontScale)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [lost, setLost] = useState(lostOnDisconnect)
  const [reconnected, setReconnected] = useState(false)
  const [error, setError] = useState('')
  const sendingRef = useRef(false)
  const canSend = live && !sending && text.trim().length > 0

  useEffect(() => {
    if (lost && connected) setReconnected(true)
  }, [lost, connected])

  const updateDraft = (next: string, nextLost = lost) => {
    setText(next)
    setLost(nextLost)
    onDraftChange?.(item, next, nextLost)
  }

  const notice = !sending ? staleItemNotice('question', live, { afterReconnect: lost && reconnected }) : null

  const submit = () =>
    runSingleSubmit(sendingRef, async () => {
      const trimmed = text.trim()
      if (!trimmed || !live) return
      setSending(true)
      setError('')
      setReconnected(false)
      try {
        await answerWorkItem(item.id, trimmed)
        Keyboard.dismiss()
        updateDraft('', false)
      } catch (failure) {
        const msg = messageOf(failure)
        if (isConnectionLostError(msg)) {
          setLost(true)
          onDraftChange?.(item, text, true)
        }
        setError(msg)
      } finally {
        setSending(false)
      }
    })

  return (
    <View
      testID={`needs-you-question-${item.id}`}
      style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: `${theme.primary}59`, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}
    >
      <Pressable onPress={() => onOpenItem(item.id)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}>
        <WorkAvatar id={item.ownerId} name={item.ownerName} size={24} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText
            color={theme.foreground}
            numberOfLines={stack ? 2 : 1}
            maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle}
            style={[MOBILE_SCALE.work.cardTitle, { fontFamily: 'Inter_600SemiBold' }]}
          >
            {item.title}
          </AppText>
          <AppText color={theme.mutedForeground} numberOfLines={1} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
            {item.ownerName} asks · {elapsedShort(now - item.updatedAt, 'ago')}
          </AppText>
        </View>
      </Pressable>

      {item.question ? (
        <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>
          {item.question}
        </AppText>
      ) : null}

      {notice ? (
        <WorkNoticeBox
          testID={`needs-you-stale-${item.id}`}
          message={notice}
          onDismiss={
            !live || reconnected
              ? () => {
                  updateDraft('', false)
                  setReconnected(false)
                  onDismissStale?.(item.id)
                }
              : undefined
          }
        />
      ) : null}

      <View style={{ flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'stretch' : 'center', gap: 8 }}>
        <WorkInput
          testID={`needs-you-input-${item.id}`}
          value={text}
          onChangeText={next => updateDraft(next)}
          onFocus={onInputFocus}
          placeholder={`Answer ${item.ownerName}`}
          accessibilityLabel={`Answer ${item.ownerName}`}
          editable={!sending}
          returnKeyType="send"
          submitBehavior="blurAndSubmit"
          onSubmitEditing={() => void submit()}
          style={{ flex: stack ? undefined : 1 }}
        />
        <WorkButton
          testID={`needs-you-send-${item.id}`}
          label={sending ? 'Sending...' : 'Send'}
          disabled={!canSend}
          accessibilityLabel={`Send answer to ${item.ownerName}`}
          onPress={() => void submit()}
        />
      </View>

      {error ? (
        <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
          {error}
        </AppText>
      ) : null}
    </View>
  )
}

function OscarCheckCard({ item, onOpenItem }: { item: WorkSummary; onOpenItem: (itemId: string) => void }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stack = shouldStackWorkRow(fontScale)
  const reason = item.checkLevel === 3 ? 'Waits for your check · Level 3' : item.question || item.check?.note || 'Waits for your check · review evidence and decide'

  return (
    <View
      testID={`needs-you-check-${item.id}`}
      style={{
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: `${theme.primary}59`,
        backgroundColor: theme.card,
        paddingHorizontal: 14,
        paddingVertical: 12,
        flexDirection: stack ? 'column' : 'row',
        alignItems: stack ? 'stretch' : 'center',
        gap: 10
      }}
    >
      <Pressable onPress={() => onOpenItem(item.id)} accessibilityRole="button" style={({ pressed }) => ({ flex: stack ? undefined : 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: pressed ? 0.7 : 1 })}>
        <WorkAvatar id={item.ownerId} name={item.ownerName} size={24} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText
            color={theme.foreground}
            numberOfLines={stack ? 2 : 1}
            maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle}
            style={[MOBILE_SCALE.work.cardTitle, { fontFamily: 'Inter_600SemiBold' }]}
          >
            {item.title}
          </AppText>
          <AppText color={theme.mutedForeground} numberOfLines={stack ? 2 : 1} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
            {reason}
          </AppText>
        </View>
      </Pressable>
      <WorkButton testID={`needs-you-look-${item.id}`} label="Look" tone="secondary" accessibilityLabel={`Look at ${item.title}`} onPress={() => onOpenItem(item.id)} />
    </View>
  )
}
