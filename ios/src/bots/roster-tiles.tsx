/** Pinned bots above sections: large round avatars directly on the canvas with centered names underneath
 *  (no card borders), primary bot first then pinnedAt order. Long-press or VoiceOver opens the bot menu. */
import { memo, useCallback } from 'react'
import { type AccessibilityActionEvent, Pressable, useWindowDimensions, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { canArrange, isUnread } from '../../../shared/client/bots/bot-menu-rules'
import { DYNAMIC_TYPE_CAPS, pinnedTileColumns } from '../ui/dynamic-type'
import { rowAccessibilityActions } from '../ui/gestures/rules'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { setBotPrefs, setBotUnread } from './actions'
import { useBotMenuStore } from './menu-store'
import { rosterRowDisplay } from './roster-state'
import { TileAvatarMarks } from './status-marks'

interface RosterTilesProps {
  bots: Bot[]
  selectedId: string | null
  splitMode: boolean
  onSelect: (bot: Bot) => void
}

export const RosterTiles = memo(function RosterTiles({ bots, selectedId, splitMode, onSelect }: RosterTilesProps) {
  const { fontScale } = useWindowDimensions()
  const columns = pinnedTileColumns(bots.length, fontScale)
  const rows: Bot[][] = []
  for (let i = 0; i < bots.length; i += columns) rows.push(bots.slice(i, i + columns))

  return (
    <View accessibilityLabel="Pinned bots" style={{ gap: 12, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12 }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={{ flexDirection: 'row', gap: splitMode ? 8 : 16 }}>
          {row.map(bot => (
            <PinnedTile key={bot.id} bot={bot} selected={bot.id === selectedId} splitMode={splitMode} narrow={columns === 3} onSelect={onSelect} />
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
  splitMode,
  narrow,
  onSelect
}: {
  bot: Bot
  selected: boolean
  splitMode: boolean
  narrow: boolean
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

  const avatarSize = splitMode
    ? narrow
      ? MOBILE_SCALE.roster.pinnedAvatarSplitThreeUp
      : MOBILE_SCALE.roster.pinnedAvatarSplitTwoUp
    : narrow
      ? MOBILE_SCALE.roster.pinnedAvatarThreeUp
      : MOBILE_SCALE.roster.pinnedAvatarTwoUp
  const surfaceColor = selected ? theme.secondary : theme.background

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
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 4,
        borderRadius: radius.xl,
        backgroundColor: selected ? theme.secondary : 'transparent',
        opacity: pressed ? 0.72 : 1
      })}
    >
      <TileAvatarMarks bot={bot} size={avatarSize} surfaceColor={surfaceColor} />
      <AppText
        numberOfLines={2}
        ellipsizeMode="tail"
        maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.pinnedLabel}
        style={{
          ...MOBILE_SCALE.roster.pinnedLabel,
          maxWidth: '100%',
          textAlign: 'center',
          fontFamily: display.boldName ? 'Inter_600SemiBold' : 'Inter_500Medium'
        }}
      >
        {bot.name}
      </AppText>
    </Pressable>
  )
})
