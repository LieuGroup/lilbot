/** Quiet conversation record for a temporary group (mirrors `web/src/threads/group-line.tsx`). */
import { useEffect, useState } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { groupState, groupTitle, isGroup } from '../../../shared/client/threads/group-lines'
import type { BotThread } from '../../../shared/thread-schema'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { shouldWrapDockPill, THREAD_TYPE_CAPS } from './dock-pill'
import { StopThreadSheet } from './stop-thread-sheet'
import { openThreadView } from './store'
import { AvatarStack, StateText } from './thread-badges'

export function GroupLine({ botId, thread }: { botId: string; thread: BotThread }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const [tick, setTick] = useState(0)
  const [stopping, setStopping] = useState(false)
  const isRunningGroup = isGroup(thread) && !thread.group.end

  useEffect(() => {
    if (!isRunningGroup) return
    const handle = setInterval(() => setTick(n => n + 1), 15_000)
    return () => clearInterval(handle)
  }, [isRunningGroup])

  if (!isGroup(thread)) return null
  const now = tick >= 0 ? Date.now() : Date.now()
  const title = groupTitle(thread, botId)
  const state = groupState(thread, now)
  const wrap = shouldWrapDockPill({ fontScale })

  return (
    <>
      <View
        testID={`group-line-${thread.id}`}
        style={{
          flexDirection: wrap ? 'column' : 'row',
          alignItems: wrap ? 'stretch' : 'center',
          gap: wrap ? 8 : 10,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.hairline,
          backgroundColor: theme.card,
          paddingVertical: 10,
          paddingHorizontal: 12
        }}
      >
        <Pressable
          onPress={() => openThreadView(botId, thread.id)}
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
          <AvatarStack people={thread.participants.slice(0, 5)} size={20} overlap={5} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <AppText
              variant="name"
              color={state.stopped ? theme.mutedForeground : theme.foreground}
              numberOfLines={wrap ? 2 : 1}
              maxFontSizeMultiplier={THREAD_TYPE_CAPS.rowTitle}
              style={{ fontFamily: 'Inter_500Medium' }}
            >
              {title}
            </AppText>
            <StateText state={state} numberOfLines={wrap ? 2 : 1} />
          </View>
          {wrap || !isRunningGroup ? <ChevronRightIcon color={theme.mutedForeground} size={14} /> : null}
        </Pressable>

        {isRunningGroup ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: wrap ? 'flex-end' : 'flex-start', gap: 6, flexShrink: 0 }}>
            <Pressable
              testID={`group-line-stop-${thread.id}`}
              onPress={() => setStopping(true)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`Stop ${title}`}
              style={({ pressed }) => ({
                minHeight: 28,
                paddingHorizontal: 10,
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: theme.hairline,
                backgroundColor: theme.background,
                alignItems: 'center',
                justifyContent: 'center',
                opacity: pressed ? 0.65 : 1
              })}
            >
              <AppText variant="preview" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
                Stop
              </AppText>
            </Pressable>
            {!wrap ? <ChevronRightIcon color={theme.mutedForeground} size={14} /> : null}
          </View>
        ) : null}
      </View>

      <StopThreadSheet botId={botId} thread={stopping ? thread : null} onClose={() => setStopping(false)} />
    </>
  )
}
