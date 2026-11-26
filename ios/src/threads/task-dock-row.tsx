/** One row inside the expanded floating Tasks dock (R3-03, R4-G3): badge/avatar, title, live state, and inline action. */
import { Pressable, useWindowDimensions, View } from 'react-native'
import { type DockItem, dockRowState, dockRowTitle } from '../../../shared/client/threads/dock-items'
import { otherName } from '../../../shared/client/threads/thread-lines'
import type { WorkSummary } from '../../../shared/work-schema'
import { ChevronRightIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { shouldWrapDockPill, THREAD_TYPE_CAPS } from './dock-pill'
import { dismissDockItem } from './store'
import { StateText, ThreadAvatar, WorkerBadge } from './thread-badges'

export interface DockRowProps {
  botId: string
  item: DockItem
  now: number
  inWorkerBatch: boolean
  onOpen: () => void
  onAnswer: (work: WorkSummary) => void
  onStop: () => void
}

export function DockRow({ botId, item, now, inWorkerBatch, onOpen, onAnswer, onStop }: DockRowProps) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const wrap = shouldWrapDockPill({ fontScale })
  const { thread } = item
  const other = thread.participants.find(p => p.id !== botId) ?? thread.participants[1]
  const title = dockRowTitle(item, botId, inWorkerBatch)
  const state = dockRowState(item, botId, now)
  const textLines = wrap ? 2 : 1

  return (
    <View
      testID={`dock-row-${thread.id}`}
      style={{
        flexDirection: wrap ? 'column' : 'row',
        alignItems: wrap ? 'stretch' : 'center',
        gap: wrap ? 8 : 10,
        paddingVertical: 10,
        paddingLeft: 12,
        paddingRight: 10
      }}
    >
      <Pressable
        testID={`dock-row-open-${thread.id}`}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open: ${title}, ${state.text}`}
        style={({ pressed }) => ({
          flex: wrap ? undefined : 1,
          minWidth: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          opacity: pressed ? 0.65 : 1
        })}
      >
        {thread.worker ? <WorkerBadge size={24} surface="card" /> : <ThreadAvatar id={other.id} name={otherName(thread, botId)} size={24} />}
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="name" color={theme.foreground} numberOfLines={textLines} maxFontSizeMultiplier={THREAD_TYPE_CAPS.rowTitle} style={{ fontFamily: 'Inter_500Medium' }}>
            {title}
          </AppText>
          <StateText state={state} strong={item.kind === 'waiting_oscar'} numberOfLines={textLines} />
        </View>
        {wrap ? <ChevronRightIcon color={theme.mutedForeground} size={14} /> : null}
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: wrap ? 'flex-end' : 'flex-start', gap: 6, flexShrink: 0 }}>
        {item.kind === 'waiting_oscar' && item.canAnswer && item.waiting ? (
          <Pressable
            testID={`dock-row-answer-${thread.id}`}
            onPress={() => onAnswer(item.waiting!)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Answer ${title}`}
            style={({ pressed }) => ({
              minHeight: 28,
              paddingHorizontal: 12,
              borderRadius: radius.pill,
              backgroundColor: theme.foreground,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.78 : 1
            })}
          >
            <AppText variant="preview" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
              Answer
            </AppText>
          </Pressable>
        ) : null}

        {item.kind === 'running' ? (
          <Pressable
            testID={`dock-row-stop-${thread.id}`}
            onPress={onStop}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Stop ${title}`}
            style={({ pressed }) => ({
              minHeight: 28,
              paddingHorizontal: 11,
              borderRadius: radius.pill,
              backgroundColor: theme.card,
              borderWidth: 1,
              borderColor: theme.hairline,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.65 : 1
            })}
          >
            <AppText variant="preview" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
              Stop
            </AppText>
          </Pressable>
        ) : null}

        {item.kind === 'finished' || item.kind === 'failed' ? (
          <Pressable
            testID={`dock-row-dismiss-${thread.id}`}
            onPress={() => dismissDockItem(botId, thread.id, item.stamp)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Dismiss ${title}`}
            style={({ pressed }) => ({
              width: 28,
              height: 28,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.6 : 1
            })}
          >
            <CloseIcon color={theme.mutedForeground} size={14} />
          </Pressable>
        ) : null}

        {!wrap ? <ChevronRightIcon color={theme.mutedForeground} size={14} /> : null}
      </View>
    </View>
  )
}

/** "For Chief of Staff" / "Handed out" above each group, only when the dock holds both kinds (Paper "26", #316). */
export function DockSectionLabel({ label }: { label: string }) {
  const theme = useTheme()
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
      <AppText
        variant="meta"
        color={theme.mutedForeground}
        numberOfLines={1}
        maxFontSizeMultiplier={THREAD_TYPE_CAPS.badge}
        style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.6, textTransform: 'uppercase' }}
      >
        {label}
      </AppText>
    </View>
  )
}
