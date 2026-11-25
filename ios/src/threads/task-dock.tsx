/** Round 4 Composer Tasks Dock (`R3-03`, `R4-G3`, `R4-01b`, `R4-02b`):
 *  - Collapsed (default): `TaskDockPill` (32 pt floating Liquid Glass pill with 1-tap ink `Answer`).
 *  - Expanded: Liquid Glass floating card with swipe-down grab handle, batch headers, Answer/Stop/dismiss rows, and tap to open. */
import { Fragment, useEffect, useState } from 'react'
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { type DockItem, dockEntries, dockHeaderSummary, dockItems, dockRowTitle, nextDockExpiryAt } from '../../../shared/client/threads/dock-items'
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { SheetDismissGesture } from '../ui/gestures/sheet-gesture'
import { GlassSurface } from '../ui/glass'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { AnswerWorkSheet } from './answer-work-sheet'
import { buildDockPillModel, shouldWrapDockPill, THREAD_TYPE_CAPS } from './dock-pill'
import { ChevronDownIcon } from './icons'
import { StopThreadSheet } from './stop-thread-sheet'
import { dismissDockItem, openThreadView, setDockCollapsed, useDismissed, useDockCollapsed, useThreads, useWaitingWork } from './store'
import { TaskDockPill } from './task-dock-pill'
import { DockRow } from './task-dock-row'
import { ThreadStatusIcon } from './thread-badges'

export interface TaskDockSlotProps {
  botId: string
}

export function TaskDockSlot({ botId }: TaskDockSlotProps) {
  const theme = useTheme()
  const { fontScale, width } = useWindowDimensions()
  const threads = useThreads(botId)
  const waitingWork = useWaitingWork()
  const dismissed = useDismissed(botId)
  const collapsed = useDockCollapsed(botId)
  const [tick, setTick] = useState(0)
  const [scrollOffsetY, setScrollOffsetY] = useState(0)
  const [answering, setAnswering] = useState<{ work: WorkSummary; title: string } | null>(null)
  const [stopping, setStopping] = useState<BotThread | null>(null)

  const now = Date.now()
  const items = threads ? dockItems(threads, botId, waitingWork, dismissed, now) : []
  const hasRunning = items.some(item => item.kind === 'running')
  const nextExpiryAt = nextDockExpiryAt(items)

  useEffect(() => {
    setScrollOffsetY(0)
    setAnswering(null)
    setStopping(null)
  }, [botId])

  useEffect(() => {
    if (!hasRunning) return
    const handle = setInterval(() => setTick(n => n + 1), 15_000)
    return () => clearInterval(handle)
  }, [hasRunning])

  useEffect(() => {
    if (nextExpiryAt === null) return
    const handle = setTimeout(() => setTick(n => n + 1), Math.max(50, nextExpiryAt - Date.now()))
    return () => clearTimeout(handle)
  }, [nextExpiryAt, tick])

  if (items.length === 0 && !answering && !stopping) return null

  const pill = buildDockPillModel(items, botId)
  const header = items.length > 0 ? dockHeaderSummary(items) : null
  const entries = dockEntries(items, threads ?? [], botId, waitingWork)
  const wrapPill = shouldWrapDockPill({ fontScale, availableWidth: width })

  const openItem = (item: DockItem) => {
    if (item.kind === 'finished' || item.kind === 'failed') dismissDockItem(botId, item.thread.id, item.stamp)
    openThreadView(botId, item.thread.id)
  }

  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
      {items.length > 0 && pill && header ? (
        collapsed ? (
          <TaskDockPill pill={pill} wrap={wrapPill} onExpand={() => setDockCollapsed(botId, false)} onAnswer={setAnswering} />
        ) : (
          <GlassSurface style={{ borderRadius: radius.xl }}>
            <View testID="tasks-dock-expanded" style={{ minHeight: 0 }}>
              <SheetDismissGesture scrollOffsetY={scrollOffsetY} onDismiss={() => setDockCollapsed(botId, true)}>
                <Pressable
                  testID="tasks-dock-collapse"
                  onPress={() => setDockCollapsed(botId, true)}
                  accessibilityRole="button"
                  accessibilityLabel={`Collapse tasks dock, ${header.text}`}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    paddingHorizontal: 12,
                    paddingBottom: 8,
                    borderBottomWidth: 1,
                    borderBottomColor: theme.hairline,
                    opacity: pressed ? 0.7 : 1
                  })}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                    <ThreadStatusIcon tone={header.icon} size={12} />
                    <AppText variant="meta" color={theme.foreground} numberOfLines={1} maxFontSizeMultiplier={THREAD_TYPE_CAPS.pillText} style={{ fontFamily: 'Inter_600SemiBold', flexShrink: 1 }}>
                      {header.text}
                    </AppText>
                  </View>
                  <ChevronDownIcon color={theme.mutedForeground} size={14} />
                </Pressable>
                <ScrollView
                  style={{ maxHeight: 236 }}
                  nestedScrollEnabled
                  scrollEventThrottle={16}
                  onScroll={event => setScrollOffsetY(event.nativeEvent.contentOffset.y)}
                >
                  {entries.map((entry, index) =>
                    entry.kind === 'single' ? (
                      <Fragment key={entry.item.thread.id}>
                        {index > 0 ? <View style={{ height: 1, backgroundColor: theme.hairline }} /> : null}
                        <DockRow
                          botId={botId}
                          item={entry.item}
                          now={now}
                          inWorkerBatch={false}
                          onOpen={() => openItem(entry.item)}
                          onAnswer={work => setAnswering({ work, title: dockRowTitle(entry.item, botId, false) })}
                          onStop={() => setStopping(entry.item.thread)}
                        />
                      </Fragment>
                    ) : (
                      <Fragment key={`batch:${entry.batchId}`}>
                        {index > 0 ? <View style={{ height: 1, backgroundColor: theme.hairline }} /> : null}
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderBottomWidth: 1,
                            borderBottomColor: theme.hairline
                          }}
                        >
                          <AppText variant="meta" color={theme.mutedForeground} numberOfLines={1} style={{ flexShrink: 1, fontFamily: 'Inter_500Medium' }}>
                            {entry.title}
                          </AppText>
                          <AppText variant="meta" color={theme.mutedForeground}>
                            {entry.progress}
                          </AppText>
                        </View>
                        {entry.items.map((item, childIndex) => (
                          <Fragment key={item.thread.id}>
                            {childIndex > 0 ? <View style={{ height: 1, backgroundColor: theme.hairline }} /> : null}
                            <DockRow
                              botId={botId}
                              item={item}
                              now={now}
                              inWorkerBatch={entry.allWorkers}
                              onOpen={() => openItem(item)}
                              onAnswer={work => setAnswering({ work, title: dockRowTitle(item, botId, false) })}
                              onStop={() => setStopping(item.thread)}
                            />
                          </Fragment>
                        ))}
                      </Fragment>
                    )
                  )}
                </ScrollView>
              </SheetDismissGesture>
            </View>
          </GlassSurface>
        )
      ) : null}

      <AnswerWorkSheet work={answering?.work ?? null} title={answering?.title ?? ''} onClose={() => setAnswering(null)} />
      <StopThreadSheet botId={botId} thread={stopping} onClose={() => setStopping(null)} />
    </View>
  )
}
