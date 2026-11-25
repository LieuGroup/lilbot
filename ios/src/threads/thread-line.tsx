/** Quiet conversation record for an exchange, worker or batch (`R3-03`, mirrors `web/src/threads/thread-line.tsx`).
 *  Exports `createThreadToolRenderer` to plug into PR #299's `ChatScreen` `renderToolItem` seam. */
import { Fragment, type ReactNode } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import type { MessageItem } from '../../../shared/client/chat/chat-state'
import { batchOf, batchSummary, isWorker, joined, lineTitle, otherName, taskTitle } from '../../../shared/client/threads/thread-lines'
import { inlineState } from '../../../shared/client/threads/worker-lines'
import type { BotThread } from '../../../shared/thread-schema'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { shouldWrapDockPill, THREAD_TYPE_CAPS } from './dock-pill'
import { clockTime } from './format-labels'
import { GroupLine } from './group-line'
import { openThreadView, useThreads, useWaitingWork } from './store'
import { StateText, ThreadAvatar, WorkerBadge } from './thread-badges'

export interface ThreadLineProps {
  botId: string
  threadId: string
  fallback: ReactNode
}

/** Quiet, clickable single-line record without a Stop button (live progress and Stop sit in the composer dock).
 *  Tasks started in one call group into one card drawn at the batch's first line. */
export function ThreadLine({ botId, threadId, fallback }: ThreadLineProps) {
  const theme = useTheme()
  const threads = useThreads(botId)
  const waitingWork = useWaitingWork()
  const thread = threads?.find(candidate => candidate.id === threadId)
  if (!threads || !thread) return <>{fallback}</>
  if (thread.group) return <GroupLine botId={botId} thread={thread} />

  const batch = batchOf(threads, thread)
  if (batch[0].id !== thread.id) return null
  if (batch.length === 1) {
    return <ThreadRow botId={botId} thread={thread} inWorkerBatch={false} framed />
  }

  const summary = batchSummary(batch, waitingWork)
  const allWorkers = batch.every(isWorker)
  return (
    <View
      testID={`thread-batch-${thread.batchId ?? thread.id}`}
      style={{
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.hairline,
        backgroundColor: theme.card,
        overflow: 'hidden'
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 12, paddingVertical: 8 }}>
        <AppText variant="meta" color={theme.mutedForeground} numberOfLines={1} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge} style={{ flexShrink: 1 }}>
          {summary.title}
        </AppText>
        <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge}>
          {summary.progress}
        </AppText>
      </View>
      {batch.map(task => (
        <Fragment key={task.id}>
          <View style={{ height: 1, backgroundColor: theme.hairline }} />
          <ThreadRow botId={botId} thread={task} inWorkerBatch={allWorkers} framed={false} />
        </Fragment>
      ))}
    </View>
  )
}

function ThreadRow({ botId, thread, inWorkerBatch, framed }: { botId: string; thread: BotThread; inWorkerBatch: boolean; framed: boolean }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const waitingWork = useWaitingWork()
  const other = thread.participants.find(p => p.id !== botId) ?? thread.participants[1]
  const where = thread.computer ? (thread.computerName ?? thread.computer) : null
  const title = thread.worker && inWorkerBatch ? joined(where, taskTitle(thread)) : lineTitle(thread, botId)
  const state = inlineState(thread, clockTime, waitingWork[thread.id])
  const wrap = shouldWrapDockPill({ fontScale })

  return (
    <Pressable
      testID={`thread-line-${thread.id}`}
      onPress={() => openThreadView(botId, thread.id)}
      accessibilityRole="button"
      accessibilityLabel={`Open: ${title}, ${state.text}`}
      style={({ pressed }) => ({
        flexDirection: wrap ? 'column' : 'row',
        alignItems: wrap ? 'stretch' : 'center',
        gap: wrap ? 4 : 8,
        paddingVertical: 9,
        paddingHorizontal: 11,
        borderRadius: framed ? radius.md : 0,
        borderWidth: framed ? 1 : 0,
        borderColor: framed ? theme.hairline : 'transparent',
        backgroundColor: theme.card,
        opacity: pressed ? 0.7 : 1
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: wrap ? undefined : 1, minWidth: 0 }}>
        {thread.worker ? <WorkerBadge size={18} /> : <ThreadAvatar id={other.id} name={otherName(thread, botId)} size={18} />}
        <AppText
          variant="name"
          color={state.stopped ? theme.mutedForeground : theme.foreground}
          numberOfLines={wrap ? 2 : 1}
          maxFontSizeMultiplier={THREAD_TYPE_CAPS.rowTitle}
          style={{ flex: 1, fontFamily: 'Inter_500Medium' }}
        >
          {title}
        </AppText>
        {wrap ? <ChevronRightIcon color={theme.mutedForeground} size={14} /> : null}
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: wrap ? 'flex-start' : 'flex-end', gap: 6, paddingLeft: wrap ? 26 : 0, flexShrink: 0 }}>
        <StateText state={state} numberOfLines={wrap ? 2 : 1} />
        {!wrap ? <ChevronRightIcon color={theme.mutedForeground} size={14} /> : null}
      </View>
    </Pressable>
  )
}

const toolRenderers = new Map<string, (item: Extract<MessageItem, { kind: 'tool' }>, fallback: ReactNode) => ReactNode>()

/** Seam callback for `ChatScreen`'s `renderToolItem` prop: swaps thread-linked tool rows for quiet `ThreadLine` records.
 *  Cached per `botId` so memoized `ChatItem` rows keep a stable prop reference across renders. */
export function createThreadToolRenderer(botId: string) {
  let cached = toolRenderers.get(botId)
  if (!cached) {
    cached = (item, fallback) => (item.threadId ? <ThreadLine botId={botId} threadId={item.threadId} fallback={fallback} /> : fallback)
    toolRenderers.set(botId, cached)
  }
  return cached
}
