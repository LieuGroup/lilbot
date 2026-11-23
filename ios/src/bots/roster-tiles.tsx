/** 3-up (or 2-up) pinned bot tiles above the sections (R4-03a, R4-01a, R4-02a): primary bot first,
 *  then pinned bots in `pinnedAt` order. Never wraps names mid-word; long-press opens the bot menu. */
import { type AccessibilityActionEvent, Pressable, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { canArrange, isUnread } from '../../../shared/client/bots/bot-menu-rules'
import { rowAccessibilityActions } from '../ui/gestures/rules'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { setBotPrefs, setBotUnread } from './actions'
import { useBotMenuStore } from './menu-store'
import { rosterRowDisplay } from './roster-state'
import { TileAvatarMarks } from './status-marks'

interface RosterTilesProps {
  bots: Bot[]
  selectedId: string | null
  compactCardSurface: boolean
  onSelect: (bot: Bot) => void
}

export function RosterTiles({ bots, selectedId, compactCardSurface, onSelect }: RosterTilesProps) {
  const columns = bots.length > 2 ? 3 : 2
  const rows: Bot[][] = []
  for (let i = 0; i < bots.length; i += columns) rows.push(bots.slice(i, i + columns))

  return (
    <View accessibilityLabel="Pinned bots" style={{ gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row', gap: 8 }}>
          {row.map(bot => (
            <PinnedTile key={bot.id} bot={bot} selected={bot.id === selectedId} cardSurface={compactCardSurface} narrow={columns === 3} onSelect={onSelect} />
          ))}
          {row.length < columns && Array.from({ length: columns - row.length }).map((_, pad) => <View key={`pad-${pad}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  )
}

function PinnedTile({ bot, selected, cardSurface, narrow, onSelect }: { bot: Bot; selected: boolean; cardSurface: boolean; narrow: boolean; onSelect: (bot: Bot) => void }) {
  const theme = useTheme()
  const display = rosterRowDisplay(bot)
  const openMenu = useBotMenuStore(state => state.openMenu)
  const a11yActions = canArrange(bot)
    ? rowAccessibilityActions({ pinned: bot.prefs.pinned, unread: display.unread, hidden: bot.prefs.hidden })
    : [
        { name: 'toggle-unread', label: display.unread ? 'Mark read' : 'Mark unread' },
        { name: 'open-menu', label: 'Bot menu' }
      ]

  const handleAction = (event: AccessibilityActionEvent) => {
    const name = event.nativeEvent.actionName
    if (name === 'toggle-pin' && canArrange(bot)) void setBotPrefs({ botId: bot.id, pinned: !bot.prefs.pinned })
    else if (name === 'toggle-unread') void setBotUnread(bot.id, !isUnread(bot))
    else if (name === 'toggle-hide' && canArrange(bot)) void setBotPrefs({ botId: bot.id, hidden: !bot.prefs.hidden })
    else if (name === 'open-menu') openMenu(bot.id)
  }

  return (
    <Pressable
      testID={`roster-tile-${bot.id}`}
      onPress={() => onSelect(bot)}
      onLongPress={() => openMenu(bot.id)}
      delayLongPress={320}
      accessibilityRole="button"
      accessibilityLabel={display.accessibilityLabel}
      accessibilityState={{ selected }}
      accessibilityActions={a11yActions}
      onAccessibilityAction={handleAction}
      style={({ pressed }) => ({
        flex: 1,
        minWidth: 0,
        minHeight: 74,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: 8,
        paddingHorizontal: 6,
        borderRadius: radius.lg,
        backgroundColor: selected ? theme.secondary : cardSurface ? theme.card : 'transparent',
        borderWidth: selected ? 1 : cardSurface ? 1 : 0,
        borderColor: selected ? theme.foreground : theme.hairline,
        opacity: pressed ? 0.78 : 1
      })}
    >
      <TileAvatarMarks bot={bot} size={narrow && cardSurface ? 34 : 40} />
      <AppText
        variant={narrow && cardSurface ? 'preview' : 'name'}
        numberOfLines={1}
        ellipsizeMode="tail"
        style={{
          maxWidth: '100%',
          textAlign: 'center',
          fontFamily: display.boldName ? 'Inter_600SemiBold' : 'Inter_500Medium'
        }}
      >
        {bot.name}
      </AppText>
    </Pressable>
  )
}
