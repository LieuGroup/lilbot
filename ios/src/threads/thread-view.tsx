/** Opened exchange or same-bot worker view (`R3-04`, `R4-02b`, mirrors `web/src/threads/thread-view.tsx`).
 *  Renders as a swipe-down sheet on compact iPhone / Folded Duo, or as an inspector pane with `✕` on Unfolded Duo / iPad. */
import { Fragment, useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { fileCounts, isTask, running, sides, stopIndex, stripState, taskTitle } from '../../../shared/client/threads/thread-lines'
import { isOpenOscarCheck, workerFooter, workerSubtitle } from '../../../shared/client/threads/worker-lines'
import type { BotThread } from '../../../shared/thread-schema'
import { useBotStore } from '../bots/store'
import { SheetDismissGesture } from '../ui/gestures/sheet-gesture'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { AnswerWorkSheet } from './answer-work-sheet'
import { duoSafeSheetPadding, THREAD_TYPE_CAPS } from './dock-pill'
import { clockTime, sessionTime } from './format-labels'
import { GroupView } from './group-view'
import { StopThreadSheet } from './stop-thread-sheet'
import { useOpenedThread, useWaitingWork } from './store'
import { StateText, WorkerBadge } from './thread-badges'
import { ThreadViewFooter, ThreadViewHeader } from './thread-chrome'
import { CentredLine, ThreadMessageRow, WorkingTail } from './thread-message'

export interface ThreadViewProps {
  botId: string
  threadId: string
  mode: 'sheet' | 'pane'
  onClose: () => void
  onSelectBot: (botId: string) => void
}

export function ThreadView({ botId, threadId, mode, onClose, onSelectBot }: ThreadViewProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { thread, error } = useOpenedThread(botId, threadId)
  const waitingWork = useWaitingWork()
  const bots = useBotStore(state => state.bots)
  const [tick, setTick] = useState(0)
  const [scrollOffsetY, setScrollOffsetY] = useState(0)
  const [answering, setAnswering] = useState(false)
  const [stopping, setStopping] = useState(false)

  const active = thread ? running(thread) : false
  useEffect(() => {
    if (!active) return
    const handle = setInterval(() => setTick(n => n + 1), 15_000)
    return () => clearInterval(handle)
  }, [active])

  if (thread?.group) {
    return <GroupView botId={botId} thread={thread} mode={mode} onClose={onClose} onSelectBot={onSelectBot} />
  }

  const pad = mode === 'sheet' ? duoSafeSheetPadding(insets) : { paddingLeft: 16, paddingRight: 16, paddingBottom: 14 }

  if (!thread) {
    const empty = (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <ThreadViewHeader title="Thread" onClose={onClose} paddingLeft={pad.paddingLeft} paddingRight={pad.paddingRight} />
        <View style={{ padding: 16 }}>
          <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground}>
            {error || 'Loading thread...'}
          </AppText>
        </View>
      </View>
    )
    return mode === 'sheet' ? (
      <SheetDismissGesture scrollOffsetY={0} onDismiss={onClose}>
        {empty}
      </SheetDismissGesture>
    ) : (
      empty
    )
  }

  const now = tick >= 0 ? Date.now() : Date.now()
  const { from, to } = sides(thread)
  const task = isTask(thread)
  const ownerBot = thread.worker ? bots.find(bot => bot.id === from.id) : undefined
  const subtitle = thread.worker ? workerSubtitle(thread, ownerBot?.model, ownerBot?.reasoningEffort) : task ? `${from.name} → ${to.name}` : false
  const title = task ? taskTitle(thread) : `${from.name} and ${to.name}`
  const footerText = thread.worker ? workerFooter(thread) : `${task ? 'You watch this.' : 'You read threads.'} To steer, talk to either bot.`
  const waiting = waitingWork[thread.id]
  const canAnswer = Boolean(waiting?.status === 'needs_oscar' && thread.status !== 'cancelled' && !isOpenOscarCheck(waiting))
  const { sent, back } = fileCounts(thread)
  const passed = sent + back
  const stop = stopIndex(thread)
  const stoppedBy = thread.stoppedBy
  const stoppedLine = stoppedBy ? <CentredLine rules>{`${stoppedBy.kind === 'oscar' ? 'Stopped by you' : `Stopped by ${stoppedBy.name}`} · ${clockTime(stoppedBy.at)}`}</CentredLine> : null

  const body = (
    <View testID={`thread-view-${thread.id}`} style={{ flex: 1, backgroundColor: theme.card }}>
      <ThreadViewHeader
        title={title}
        subtitle={subtitle}
        leading={thread.worker ? <WorkerBadge size={22} /> : undefined}
        onStop={task && active ? () => setStopping(true) : undefined}
        onClose={mode === 'pane' ? onClose : undefined}
        paddingLeft={pad.paddingLeft}
        paddingRight={pad.paddingRight}
      />

      {task ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: theme.hairline, backgroundColor: theme.background }}>
          <View style={{ flex: 1, minWidth: 120 }}>
            <StateText state={stripState(thread, now, waiting)} strong numberOfLines={2} />
          </View>
          {passed > 0 ? (
            <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge}>
              {passed === 1 ? '1 file passed' : `${passed} files passed`}
            </AppText>
          ) : null}
          {canAnswer ? (
            <Pressable
              testID="thread-view-answer"
              onPress={() => setAnswering(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Answer ${title}`}
              style={({ pressed }) => ({ minHeight: 28, paddingHorizontal: 12, borderRadius: radius.pill, backgroundColor: theme.foreground, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.78 : 1 })}
            >
              <AppText variant="preview" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
                Answer
              </AppText>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        scrollEventThrottle={16}
        onScroll={event => setScrollOffsetY(event.nativeEvent.contentOffset.y)}
        contentContainerStyle={{ paddingLeft: pad.paddingLeft, paddingRight: pad.paddingRight, paddingTop: 14, paddingBottom: 20, gap: 16 }}
      >
        <CentredLine>{`${sessionTime(thread.createdAt)} · started from ${from.name}'s chat`}</CentredLine>
        {thread.messages.map((message, index) => (
          <Fragment key={message.id}>
            {index === stop ? stoppedLine : null}
            <ThreadMessageRow thread={thread} message={message} isFirst={index === 0} />
          </Fragment>
        ))}
        {stop === thread.messages.length ? stoppedLine : null}
        {thread.status === 'working' ? <WorkingTail thread={thread} /> : null}
      </ScrollView>

      <ThreadViewFooter
        text={footerText}
        participants={thread.worker ? [from] : thread.participants}
        steerPrefix={Boolean(thread.worker)}
        onSelectBot={targetId => {
          onClose()
          onSelectBot(targetId)
        }}
        paddingLeft={pad.paddingLeft}
        paddingRight={pad.paddingRight}
        paddingBottom={pad.paddingBottom}
      />

      <AnswerWorkSheet work={answering && canAnswer && waiting ? waiting : null} title={thread.worker ? `Worker · ${title}` : `${to.name} · ${title}`} onClose={() => setAnswering(false)} />
      <StopThreadSheet botId={botId} thread={stopping ? thread : null} onClose={() => setStopping(false)} />
    </View>
  )

  if (mode === 'sheet') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.card }}>
        <SheetDismissGesture scrollOffsetY={scrollOffsetY} onDismiss={onClose}>
          {body}
        </SheetDismissGesture>
      </View>
    )
  }

  return body
}
