/** Single-line 44 pt Roster row (R4-03a / R4-01a / R4-G2): 28 pt avatar, bot name, inline rowState text,
 *  and trailing status mark inside scroll-gated SwipeRow (Pin · Read · Hide). Long-press opens the Bot menu. */
import { View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { canArrange, isUnread } from '../../../shared/client/bots/bot-menu-rules'
import { BotAvatar } from '../ui/avatar'
import { rowAccessibilityActions } from '../ui/gestures/rules'
import { SwipeRow, type SwipeRowAction } from '../ui/gestures/swipe-row'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { setBotPrefs, setBotUnread } from './actions'
import { useBotMenuStore } from './menu-store'
import { rosterRowDisplay, rosterSwipeActionSpecs } from './roster-state'
import { StatusMark } from './status-marks'

interface RosterRowProps {
  bot: Bot
  selected: boolean
  compactCardSurface: boolean
  showDivider: boolean
  scrollingVertically: boolean
  onSelect: (bot: Bot) => void
}

export function RosterRow({ bot, selected, compactCardSurface, showDivider, scrollingVertically, onSelect }: RosterRowProps) {
  const theme = useTheme()
  const openMenu = useBotMenuStore(state => state.openMenu)
  const display = rosterRowDisplay(bot)
  const unread = isUnread(bot)

  const swipeActions: SwipeRowAction[] = rosterSwipeActionSpecs(bot).map(spec => ({
    id: spec.id,
    label: spec.label,
    tone: spec.tone,
    onPress: () => {
      if (spec.id === 'toggle-pin') void setBotPrefs({ botId: bot.id, pinned: !bot.prefs.pinned })
      else if (spec.id === 'toggle-unread') void setBotUnread(bot.id, !unread)
      else if (spec.id === 'toggle-hide') void setBotPrefs({ botId: bot.id, hidden: !bot.prefs.hidden })
    }
  }))

  const a11yActions = canArrange(bot)
    ? rowAccessibilityActions({ pinned: bot.prefs.pinned, unread, hidden: bot.prefs.hidden })
    : [
        { name: 'toggle-unread', label: unread ? 'Mark read' : 'Mark unread' },
        { name: 'open-menu', label: 'Bot menu' }
      ]

  const inlineColor =
    display.inlineTone === 'destructive' ? theme.destructive : display.inlineTone === 'foreground' ? theme.foreground : theme.mutedForeground

  const rowBackground = selected ? theme.secondary : compactCardSurface ? theme.card : theme.background

  return (
    <SwipeRow
      testID={`roster-row-${bot.id}`}
      actions={swipeActions}
      onPress={() => onSelect(bot)}
      onLongPress={() => openMenu(bot.id)}
      rowBackground={rowBackground}
      scrollingVertically={scrollingVertically}
      accessibilityLabel={display.accessibilityLabel}
      accessibilityState={{ selected }}
      accessibilityActions={a11yActions}
      onAccessibilityAction={name => {
        if (name === 'open-menu') openMenu(bot.id)
      }}
    >
      <View
        style={{
          minHeight: 44,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: compactCardSurface ? 12 : 16,
          paddingVertical: 8,
          borderTopWidth: showDivider ? 1 : 0,
          borderTopColor: theme.hairline
        }}
      >
        <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={28} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
          <AppText
            variant="name"
            numberOfLines={1}
            ellipsizeMode="tail"
            style={{
              flexShrink: display.inlineText ? 0 : 1,
              maxWidth: display.inlineText ? '58%' : '100%',
              fontFamily: display.boldName ? 'Inter_600SemiBold' : 'Inter_500Medium'
            }}
          >
            {bot.name}
          </AppText>
          {display.inlineText ? (
            <AppText variant="preview" color={inlineColor} numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, minWidth: 0 }}>
              {display.inlineText}
            </AppText>
          ) : null}
        </View>
        <View style={{ width: 20, alignItems: 'center', justifyContent: 'center' }}>
          <StatusMark mark={display.trailingMark} />
        </View>
      </View>
    </SwipeRow>
  )
}
