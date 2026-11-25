/** Opened temporary group view (mirrors `web/src/threads/group-view.tsx`): participant strip, outcome card,
 *  round dividers, pending replies, Stop group, and Steer in leader footer. */
import { Fragment, useEffect, useState } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type GroupThread, groupSubtitle, isGroup, leaderOf, outcomeCard, pendingReplies, roundLabel, shortNames } from '../../../shared/client/threads/group-lines'
import type { BotThread } from '../../../shared/thread-schema'
import { WorkingSpinner } from '../bots/status-marks'
import { useScreenReaderEnabled } from '../duo/use-surface'
import { SheetDismissGesture } from '../ui/gestures/sheet-gesture'
import { CheckIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { duoSafeSheetPadding, THREAD_TYPE_CAPS } from './dock-pill'
import { clockTime, THREAD_DATE_LABELS } from './format-labels'
import { StopThreadSheet } from './stop-thread-sheet'
import { ThreadAvatar } from './thread-badges'
import { ThreadViewFooter, ThreadViewHeader } from './thread-chrome'
import { CentredLine, FileChip, ThreadMessageRow } from './thread-message'

export interface GroupViewProps {
  botId: string
  thread: BotThread
  mode: 'sheet' | 'pane'
  onClose: () => void
  onSelectBot: (botId: string) => void
}

export function GroupView({ botId, thread, mode, onClose, onSelectBot }: GroupViewProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const screenReaderEnabled = useScreenReaderEnabled()
  const [tick, setTick] = useState(0)
  const [scrollOffsetY, setScrollOffsetY] = useState(0)
  const [stopping, setStopping] = useState(false)
  const runningGroup = isGroup(thread) && thread.group.end === null

  useEffect(() => {
    if (!runningGroup) return
    const handle = setInterval(() => setTick(n => n + 1), 15_000)
    return () => clearInterval(handle)
  }, [runningGroup])

  if (!isGroup(thread)) return null

  const now = tick >= 0 ? Date.now() : Date.now()
  const pad = mode === 'sheet' ? duoSafeSheetPadding(insets) : { paddingLeft: 16, paddingRight: 16, paddingBottom: 14 }
  const leader = leaderOf(thread)
  const ended = thread.group.end !== null
  const pending = pendingReplies(thread)

  const content = (
    <View testID={`group-view-${thread.id}`} style={{ flex: 1, backgroundColor: theme.card }}>
      <ThreadViewHeader
        title={thread.group.purpose}
        subtitle={groupSubtitle(thread, now, THREAD_DATE_LABELS)}
        stopLabel="Stop group"
        onStop={!ended ? () => setStopping(true) : undefined}
        onClose={mode === 'pane' || screenReaderEnabled ? onClose : undefined}
        paddingLeft={pad.paddingLeft}
        paddingRight={pad.paddingRight}
      />

      {!ended ? <ParticipantStrip thread={thread} paddingLeft={pad.paddingLeft} paddingRight={pad.paddingRight} /> : null}

      <ScrollView
        style={{ flex: 1 }}
        scrollEventThrottle={16}
        onScroll={event => setScrollOffsetY(event.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingTop: 14, paddingBottom: 20, gap: 16 }}
      >
        {ended ? <GroupOutcomeCard thread={thread} now={now} /> : null}

        {thread.messages.map(message => {
          const round = message.round ? thread.group.rounds.find(r => r.n === message.round) : undefined
          return (
            <Fragment key={message.id}>
              {round ? <CentredLine rules>{roundLabel(thread, round, clockTime(round.at))}</CentredLine> : null}
              <ThreadMessageRow thread={thread} message={message} />
            </Fragment>
          )
        })}

        {pending.length > 0 ? (
          <View style={{ paddingLeft: 27, gap: 8 }} accessibilityLabel="Replies this round">
            {pending.map(row => (
              <View key={row.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ThreadAvatar id={row.id} name={row.name} size={18} />
                <AppText variant="preview" color={theme.foreground} numberOfLines={2} style={{ flex: 1 }}>
                  {row.text}
                </AppText>
                {row.tone === 'finished' ? <CheckIcon color={theme.success} size={13} /> : null}
                {row.tone === 'working' ? <WorkingSpinner color={theme.primary} size={13} /> : null}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <ThreadViewFooter
        text={
          ended
            ? `This group has disbanded. It stays readable from the line in ${leader.name}'s chat and from its Activity tab.`
            : 'You watch groups. To steer, tell the leader in its chat.'
        }
        participants={ended ? [] : [leader]}
        steerPrefix
        onSelectBot={targetId => {
          onClose()
          onSelectBot(targetId)
        }}
        paddingLeft={pad.paddingLeft}
        paddingRight={pad.paddingRight}
        paddingBottom={pad.paddingBottom}
      />

      <StopThreadSheet botId={botId} thread={stopping ? thread : null} onClose={() => setStopping(false)} />
    </View>
  )

  if (mode === 'sheet') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.card }}>
        <SheetDismissGesture scrollOffsetY={scrollOffsetY} onDismiss={onClose}>
          {content}
        </SheetDismissGesture>
      </View>
    )
  }

  return content
}

function ParticipantStrip({ thread, paddingLeft, paddingRight }: { thread: GroupThread; paddingLeft: number; paddingRight: number }) {
  const theme = useTheme()
  const short = shortNames(thread)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft, paddingRight, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: theme.hairline, backgroundColor: theme.background }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, alignItems: 'center' }} style={{ flex: 1 }}>
        {thread.participants.map((bot, index) => (
          <View key={bot.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 3, paddingLeft: 4, paddingRight: 8, borderRadius: radius.pill, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
            <ThreadAvatar id={bot.id} name={bot.name} size={16} />
            <AppText variant="meta" color={theme.foreground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge} style={index === 0 ? { fontFamily: 'Inter_500Medium' } : undefined}>
              {short.get(bot.id)}
            </AppText>
          </View>
        ))}
      </ScrollView>
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge} style={{ flexShrink: 0 }}>
        Round {thread.group.rounds.length} of {thread.group.roundCap}
      </AppText>
    </View>
  )
}

function GroupOutcomeCard({ thread, now }: { thread: GroupThread; now: number }) {
  const theme = useTheme()
  const card = outcomeCard(thread, now)
  const kept = thread.group.kept
  return (
    <View style={{ borderRadius: radius.lg, backgroundColor: theme.background, padding: 14, gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <AppText variant="meta" color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
          {card.title}
        </AppText>
        <AppText variant="meta" color={theme.mutedForeground}>
          {card.stats}
        </AppText>
      </View>
      {card.text ? (
        <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>
          {card.text}
        </AppText>
      ) : null}
      {kept.length > 0 ? (
        <View style={{ gap: 6, paddingTop: 2 }}>
          <AppText variant="meta" color={theme.mutedForeground}>
            Kept by the leader
          </AppText>
          {kept.map((file, index) => (
            <FileChip key={`${file.name}-${index}`} file={file} />
          ))}
        </View>
      ) : null}
    </View>
  )
}
