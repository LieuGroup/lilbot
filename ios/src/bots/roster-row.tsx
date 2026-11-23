/** Memoized single-line 44 pt Roster row: 28 pt avatar, name (+ primary star when not tiled), inline rowState,
 *  and simultaneous trailing status/unread marks inside scroll-gated SwipeRow. Long-press or Manage mode opens bot menu. */
import { memo, useCallback, useMemo } from 'react'
import { Pressable, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import type { Bot } from '../../../shared/bot-schema'
import { canArrange, isUnread } from '../../../shared/client/bots/bot-menu-rules'
import { BotAvatar } from '../ui/avatar'
import { rowAccessibilityActions } from '../ui/gestures/rules'
import { SwipeRow, type SwipeRowAction } from '../ui/gestures/swipe-row'
import { MoreHorizontalIcon, StarIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { setBotPrefs, setBotUnread } from './actions'
import { useBotMenuStore } from './menu-store'
import { rosterRowDisplay, rosterSwipeActionSpecs } from './roster-state'
import { RowStatusMarks } from './status-marks'

interface RosterRowProps {
  bot: Bot
  selected: boolean
  compactCardSurface: boolean
  isFirst: boolean
  isLast: boolean
  spacedTop: boolean
  manageMode: boolean
  scrollingVertically: SharedValue<boolean>
  onSelect: (bot: Bot) => void
}

export const RosterRow = memo(function RosterRow({
  bot,
  selected,
  compactCardSurface,
  isFirst,
  isLast,
  spacedTop,
  manageMode,
  scrollingVertically,
  onSelect
}: RosterRowProps) {
  const theme = useTheme()
  const openMenu = useBotMenuStore(state => state.openMenu)
  const display = rosterRowDisplay(bot)
  const unread = isUnread(bot)

  const swipeActions = useMemo<SwipeRowAction[]>(
    () =>
      rosterSwipeActionSpecs(bot).map(spec => ({
        id: spec.id,
        label: spec.label,
        accessibilityLabel: spec.accessibilityLabel,
        tone: spec.tone,
        onPress: () => {
          if (spec.id === 'toggle-pin') void setBotPrefs({ botId: bot.id, pinned: !bot.prefs.pinned })
          else if (spec.id === 'toggle-unread') void setBotUnread(bot.id, !unread)
          else if (spec.id === 'toggle-hide') void setBotPrefs({ botId: bot.id, hidden: !bot.prefs.hidden })
        }
      })),
    [bot, unread]
  )

  const a11yActions = useMemo(
    () =>
      rowAccessibilityActions({
        pinned: bot.prefs.pinned,
        unread,
        hidden: bot.prefs.hidden,
        arrangeable: canArrange(bot)
      }),
    [bot, unread]
  )

  const handlePress = useCallback(() => onSelect(bot), [bot, onSelect])
  const handleLongPress = useCallback(() => openMenu(bot.id), [bot.id, openMenu])
  const handleA11yAction = useCallback(
    (name: string) => {
      if (name === 'open-menu') openMenu(bot.id)
    },
    [bot.id, openMenu]
  )

  const inlineColor =
    display.inlineTone === 'destructive' ? theme.destructive : display.inlineTone === 'foreground' ? theme.foreground : theme.mutedForeground
  const rowBackground = selected ? theme.secondary : compactCardSurface ? theme.card : theme.background

  const cardContainerStyle = compactCardSurface
    ? {
        marginHorizontal: 12,
        marginTop: spacedTop ? 8 : 0,
        backgroundColor: theme.card,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: isFirst ? 1 : 0,
        borderBottomWidth: isLast ? 1 : 0,
        borderColor: theme.hairline,
        borderTopLeftRadius: isFirst ? radius.lg : 0,
        borderTopRightRadius: isFirst ? radius.lg : 0,
        borderBottomLeftRadius: isLast ? radius.lg : 0,
        borderBottomRightRadius: isLast ? radius.lg : 0,
        overflow: 'hidden' as const
      }
    : {
        marginTop: spacedTop ? 8 : 0,
        borderTopWidth: isFirst ? 1 : 0,
        borderBottomWidth: isLast ? 1 : 0,
        borderColor: theme.hairline
      }

  return (
    <View style={cardContainerStyle}>
      <SwipeRow
        rowId={bot.id}
        testID={`roster-row-${bot.id}`}
        actions={swipeActions}
        onPress={handlePress}
        onLongPress={handleLongPress}
        rowBackground={rowBackground}
        scrollingVertically={scrollingVertically}
        accessibilityLabel={display.accessibilityLabel}
        accessibilityState={{ selected }}
        accessibilityActions={a11yActions}
        onAccessibilityAction={handleA11yAction}
      >
        <View
          style={{
            minHeight: 44,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: compactCardSurface ? 12 : 16,
            paddingVertical: 8,
            borderTopWidth: isFirst ? 0 : 1,
            borderTopColor: theme.hairline
          }}
        >
          <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={28} />
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
            <AppText
              variant="name"
              numberOfLines={1}
              ellipsizeMode="tail"
              style={{
                flexShrink: display.inlineText ? 0 : 1,
                maxWidth: display.inlineText ? '56%' : '100%',
                fontFamily: display.boldName ? 'Inter_600SemiBold' : 'Inter_500Medium'
              }}
            >
              {bot.name}
            </AppText>
            {display.showPrimaryStar && <StarIcon color={theme.mutedForeground} size={11} />}
            {display.inlineText ? (
              <AppText variant="preview" color={inlineColor} numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, minWidth: 0 }}>
                {display.inlineText}
              </AppText>
            ) : null}
          </View>
          <RowStatusMarks statusMark={display.statusMark} unread={display.unread} />
          {manageMode && (
            <Pressable
              testID={`roster-row-menu-${bot.id}`}
              onPress={handleLongPress}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`More for ${bot.name}`}
              style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}
            >
              <MoreHorizontalIcon color={theme.mutedForeground} size={16} />
            </Pressable>
          )}
        </View>
      </SwipeRow>
    </View>
  )
})
