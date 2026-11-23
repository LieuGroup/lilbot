/** 3-up (or 2-up) pinned bot tiles above sections: primary bot first (with star badge when idle),
 *  then pinned bots in pinnedAt order. Memoized for 200-bot lists; long-press or Manage mode opens bot menu. */
import { memo, useCallback } from 'react'
import { type AccessibilityActionEvent, Pressable, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { canArrange, isUnread } from '../../../shared/client/bots/bot-menu-rules'
import { rowAccessibilityActions } from '../ui/gestures/rules'
import { MoreHorizontalIcon } from '../ui/icon'
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
  manageMode: boolean
  onSelect: (bot: Bot) => void
}

export const RosterTiles = memo(function RosterTiles({ bots, selectedId, compactCardSurface, manageMode, onSelect }: RosterTilesProps) {
  const columns = bots.length > 2 ? 3 : 2
  const rows: Bot[][] = []
  for (let i = 0; i < bots.length; i += columns) rows.push(bots.slice(i, i + columns))

  return (
    <View accessibilityLabel="Pinned bots" style={{ gap: 8, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 8 }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row', gap: 8 }}>
          {row.map(bot => (
            <PinnedTile
              key={bot.id}
              bot={bot}
              selected={bot.id === selectedId}
              cardSurface={compactCardSurface}
              narrow={columns === 3}
              manageMode={manageMode}
              onSelect={onSelect}
            />
          ))}
          {row.length < columns && Array.from({ length: columns - row.length }).map((_, pad) => <View key={`pad-${pad}`} style={{ flex: 1 }} />)}
        </View>
      ))}
    </View>
  )
})

const PinnedTile = memo(function PinnedTile({
  bot,
  selected,
  cardSurface,
  narrow,
  manageMode,
  onSelect
}: {
  bot: Bot
  selected: boolean
  cardSurface: boolean
  narrow: boolean
  manageMode: boolean
  onSelect: (bot: Bot) => void
}) {
  const theme = useTheme()
  const display = rosterRowDisplay(bot)
  const openMenu = useBotMenuStore(state => state.openMenu)
  const a11yActions = rowAccessibilityActions({
    pinned: bot.prefs.pinned,
    unread: display.unread,
    hidden: bot.prefs.hidden,
    arrangeable: canArrange(bot)
  })

  const handleAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const name = event.nativeEvent.actionName
      if (name === 'toggle-pin' && canArrange(bot)) void setBotPrefs({ botId: bot.id, pinned: !bot.prefs.pinned })
      else if (name === 'toggle-unread') void setBotUnread(bot.id, !isUnread(bot))
      else if (name === 'toggle-hide' && canArrange(bot)) void setBotPrefs({ botId: bot.id, hidden: !bot.prefs.hidden })
      else if (name === 'open-menu') openMenu(bot.id)
    },
    [bot, openMenu]
  )

  const surfaceColor = selected ? theme.secondary : cardSurface ? theme.card : theme.background

  return (
    <View style={{ flex: 1, minWidth: 0, position: 'relative' }}>
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
        <TileAvatarMarks bot={bot} size={narrow && cardSurface ? 34 : 40} surfaceColor={surfaceColor} />
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
      {manageMode && (
        <Pressable
          testID={`roster-tile-menu-${bot.id}`}
          onPress={() => openMenu(bot.id)}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`More for ${bot.name}`}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: theme.card,
            borderWidth: 1,
            borderColor: theme.hairline,
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <MoreHorizontalIcon color={theme.foreground} size={14} />
        </Pressable>
      )}
    </View>
  )
})
