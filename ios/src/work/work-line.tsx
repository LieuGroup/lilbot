/** Quiet Work item row inside a bot's conversation (mirrors `web/src/work/work-line.tsx`) on MOBILE_SCALE.work. */
import type { ReactNode } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import { workLineStatus } from '../../../shared/client/work/work-lines'
import type { RenderToolItem } from '../chat/message-item'
import { ChevronRightIcon, WorkTabIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { shouldStackWorkRow, WORK_TYPE_CAPS } from './board-state'
import { CheckBadge } from './check-badge'
import { useWorkItem } from './store'

export interface WorkLineProps {
  workItemId: string
  onOpenItem: (itemId: string) => void
  fallback?: ReactNode
}

export function WorkLine({ workItemId, onOpenItem, fallback = null }: WorkLineProps) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stack = shouldStackWorkRow(fontScale)
  const { item } = useWorkItem(workItemId)
  if (!item) return fallback

  return (
    <Pressable
      testID={`chat-work-line-${item.id}`}
      onPress={() => onOpenItem(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`Work: ${item.title}. ${workLineStatus(item, item.children)}`}
      style={({ pressed }) => ({
        flexDirection: stack ? 'column' : 'row',
        alignItems: stack ? 'stretch' : 'center',
        gap: stack ? 6 : 10,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.hairline,
        backgroundColor: pressed ? theme.muted : theme.card,
        paddingVertical: 11,
        paddingLeft: 14,
        paddingRight: 12
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: stack ? undefined : 1, minWidth: 0 }}>
        <WorkTabIcon color={theme.mutedForeground} size={17} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText
            color={theme.foreground}
            numberOfLines={stack ? 2 : 1}
            maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle}
            style={[MOBILE_SCALE.work.rowTitle, { fontFamily: 'Inter_500Medium' }]}
          >
            Work · {item.title}
          </AppText>
          <AppText
            color={theme.mutedForeground}
            numberOfLines={stack ? 2 : 1}
            maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta}
            style={MOBILE_SCALE.work.rowMeta}
          >
            {workLineStatus(item, item.children)}
          </AppText>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: stack ? 'space-between' : 'flex-end', gap: 6, paddingLeft: stack ? 27 : 0 }}>
        <CheckBadge item={item} />
        <ChevronRightIcon color={theme.mutedForeground} size={14} />
      </View>
    </Pressable>
  )
}

/** Composes a chat tool renderer so `lilbot_work` tool calls render quiet inline `WorkLine` cards while delegating other tools. */
export function withWorkToolRenderer(onOpenItem: (itemId: string) => void, next?: RenderToolItem): RenderToolItem {
  return (item, fallback) => {
    if (item.workItemId) return <WorkLine workItemId={item.workItemId} onOpenItem={onOpenItem} fallback={fallback} />
    return next ? next(item, fallback) : fallback
  }
}
