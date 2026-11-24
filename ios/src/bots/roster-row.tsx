/** Memoized open two-line Roster row: large avatar, bold name on line 1, one-line muted state/preview
 *  from shared rowState(bot) on line 2, and trailing status/unread marks inside scroll-gated SwipeRow. */
import { memo, useCallback, useMemo } from 'react'
import { useWindowDimensions, View } from 'react-native'
import type { SharedValue } from 'react-native-reanimated'
import type { Bot } from '../../../shared/bot-schema'
import { canArrange, isUnread } from '../../../shared/client/bots/bot-menu-rules'
import { BotAvatar } from '../ui/avatar'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines, scaledRowAvatarSize } from '../ui/dynamic-type'
import { rowAccessibilityActions } from '../ui/gestures/rules'
import { SwipeRow, type SwipeRowAction } from '../ui/gestures/swipe-row'
import { StarIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { setBotPrefs, setBotUnread } from './actions'
import { useBotMenuStore } from './menu-store'
import { rosterRowDisplay, rosterSwipeActionSpecs, sameRosterBotDisplay } from './roster-state'
import { RowStatusMarks } from './status-marks'

interface RosterRowProps {
  bot: Bot
  selected: boolean
  splitMode: boolean
  spacedTop: boolean
  scrollingVertically: SharedValue<boolean>
  onSelect: (bot: Bot) => void
}

function areRosterRowPropsEqual(prev: RosterRowProps, next: RosterRowProps): boolean {
  return (
    prev.selected === next.selected &&
    prev.splitMode === next.splitMode &&
    prev.spacedTop === next.spacedTop &&
    prev.scrollingVertically === next.scrollingVertically &&
    prev.onSelect === next.onSelect &&
    sameRosterBotDisplay(prev.bot, next.bot)
  )
}

export const RosterRow = memo(function RosterRow({ bot, selected, splitMode, spacedTop, scrollingVertically, onSelect }: RosterRowProps) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
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

  const previewColor =
    display.inlineTone === 'destructive' ? theme.destructive : display.inlineTone === 'foreground' ? theme.foreground : theme.mutedForeground
  const rowBackground = selected ? theme.secondary : theme.background
  const avatarSize = scaledRowAvatarSize(splitMode ? MOBILE_SCALE.roster.rowAvatarSplit : MOBILE_SCALE.roster.rowAvatar, fontScale)
  const minHeight = splitMode ? MOBILE_SCALE.roster.rowMinHeightSplit : MOBILE_SCALE.roster.rowMinHeight
  const textLines = rosterRowTextLines(fontScale)

  return (
    <View style={{ marginTop: spacedTop ? 8 : 0, paddingHorizontal: selected ? 8 : 0 }}>
      <View style={{ borderRadius: selected ? radius.lg : 0, overflow: 'hidden' }}>
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
          <View style={{ minHeight, flexDirection: 'row', alignItems: 'center', gap: splitMode ? 12 : 14, paddingHorizontal: selected ? 8 : 16, paddingVertical: splitMode ? 10 : 12 }}>
            <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={avatarSize} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <AppText
                  numberOfLines={textLines}
                  ellipsizeMode="tail"
                  style={{ ...MOBILE_SCALE.roster.rowName, flex: 1, minWidth: 0, fontFamily: 'Inter_600SemiBold' }}
                >
                  {bot.name}
                </AppText>
                {display.showPrimaryStar && <StarIcon color={theme.mutedForeground} size={13} />}
                {display.timeText ? (
                  <AppText
                    testID={`roster-row-time-${bot.id}`}
                    numberOfLines={1}
                    maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowTime}
                    color={theme.mutedForeground}
                    style={{ ...MOBILE_SCALE.roster.rowTime, flexShrink: 0, fontFamily: 'Inter_400Regular' }}
                  >
                    {display.timeText}
                  </AppText>
                ) : null}
                <RowStatusMarks statusMark={display.statusMark} unread={display.unread} />
              </View>
              {display.inlineText ? (
                <AppText color={previewColor} numberOfLines={textLines} ellipsizeMode="tail" style={{ ...MOBILE_SCALE.roster.rowPreview, fontFamily: 'Inter_400Regular' }}>
                  {display.inlineText}
                </AppText>
              ) : null}
            </View>
          </View>
        </SwipeRow>
      </View>
    </View>
  )
}, areRosterRowPropsEqual)
