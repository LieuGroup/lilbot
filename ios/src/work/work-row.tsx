/** Compact work item row for "All work" (with recursive parent/child nesting) and item Parts lists. */
import { Fragment } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import type { TreeRow } from '../../../shared/client/work/work-groups'
import { elapsedShort } from '../../../shared/client/work/work-lines'
import type { WorkSummary } from '../../../shared/work-schema'
import { WorkingSpinner } from '../bots/status-marks'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { shouldStackWorkRow, WORK_TYPE_CAPS } from './board-state'
import { CheckBadge } from './check-badge'
import { WorkAvatar } from './work-avatar'

export function TreeRows({ row, now, depth = 0, onOpenItem }: { row: TreeRow; now: number; depth?: number; onOpenItem: (itemId: string) => void }) {
  return (
    <Fragment>
      <WorkRow item={row.item} now={now} emphasis={depth === 0} depth={depth} parts={row.children.length} onOpenItem={onOpenItem} />
      {row.children.map(child => (
        <TreeRows key={child.item.id} row={child} now={now} depth={depth + 1} onOpenItem={onOpenItem} />
      ))}
    </Fragment>
  )
}

export function WorkRow({
  item,
  now,
  emphasis = false,
  depth = 0,
  parts = 0,
  selected = false,
  onOpenItem
}: {
  item: WorkSummary
  now: number
  emphasis?: boolean
  depth?: number
  parts?: number
  selected?: boolean
  onOpenItem: (itemId: string) => void
}) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stack = shouldStackWorkRow(fontScale)
  const active = item.status === 'open' || item.status === 'working' || item.status === 'checking'
  const sentBack = active && (item.check?.state === 'not_verified' || item.check?.state === 'sent_back')
  const padLeft = depth === 0 ? 10 : depth === 1 ? 26 : 42

  const trailing =
    item.status === 'needs_oscar' ? (
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge}>
        {elapsedShort(now - item.updatedAt)}
      </AppText>
    ) : sentBack ? (
      <AppText variant="meta" color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge}>
        sent back
      </AppText>
    ) : parts > 0 ? (
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge}>
        {parts === 1 ? '1 part' : `${parts} parts`}
      </AppText>
    ) : item.status === 'dropped' ? (
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge}>
        dropped
      </AppText>
    ) : (
      <CheckBadge item={item} />
    )

  return (
    <Pressable
      testID={`work-row-${item.id}`}
      onPress={() => onOpenItem(item.id)}
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${item.ownerName}`}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: stack ? 'column' : 'row',
        alignItems: stack ? 'stretch' : 'center',
        gap: stack ? 4 : 8,
        paddingVertical: 9,
        paddingLeft: padLeft,
        paddingRight: 10,
        borderRadius: radius.md,
        backgroundColor: selected ? theme.muted : pressed ? theme.muted : 'transparent'
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: stack ? undefined : 1, minWidth: 0 }}>
        <View style={{ width: 12, alignItems: 'center', justifyContent: 'center' }}>
          {item.status === 'needs_oscar' ? (
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
          ) : active ? (
            <WorkingSpinner color={theme.primary} size={12} />
          ) : null}
        </View>
        <WorkAvatar id={item.ownerId} name={item.ownerName} size={20} />
        <AppText
          variant="name"
          color={item.status === 'dropped' ? theme.mutedForeground : theme.foreground}
          numberOfLines={stack ? 2 : 1}
          maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle}
          style={{ flex: 1, fontFamily: emphasis ? 'Inter_500Medium' : 'Inter_400Regular' }}
        >
          {item.title}
        </AppText>
      </View>
      <View style={{ alignSelf: stack ? 'flex-start' : 'center', paddingLeft: stack ? 40 : 0, flexShrink: 0 }}>{trailing}</View>
    </Pressable>
  )
}
