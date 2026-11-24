/** Active temporary groups ("Working together") shown above user sections whenever a group runs.
 *  Driven directly by `runningGroups(bots)` from `shared/client/bots/running-groups.ts`. */
import { memo } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import type { RunningGroup } from '../../../shared/client/bots/running-groups'
import { BotAvatar } from '../ui/avatar'
import { rosterRowTextLines, scaledRowAvatarSize } from '../ui/dynamic-type'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { WorkingSpinner } from './status-marks'

interface WorkingTogetherProps {
  groups: RunningGroup[]
  splitMode: boolean
  onSelectBot: (bot: Bot) => void
}

export const WorkingTogether = memo(function WorkingTogether({ groups, splitMode, onSelectBot }: WorkingTogetherProps) {
  if (groups.length === 0) return null
  return (
    <View style={{ marginBottom: 4 }}>
      {groups.map(group => (
        <GroupRow key={group.id} group={group} splitMode={splitMode} onSelectBot={onSelectBot} />
      ))}
    </View>
  )
})

function GroupRow({ group, splitMode, onSelectBot }: { group: RunningGroup; splitMode: boolean; onSelectBot: (bot: Bot) => void }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const leader = group.bots[0]
  const avatarSize = scaledRowAvatarSize(splitMode ? MOBILE_SCALE.roster.rowAvatarSplit : MOBILE_SCALE.roster.rowAvatar, fontScale)
  const textLines = rosterRowTextLines(fontScale)
  return (
    <Pressable
      testID={`working-group-${group.id}`}
      onPress={() => leader && onSelectBot(leader)}
      accessibilityRole="button"
      accessibilityLabel={`Working together: ${group.purpose}, Round ${group.round}, ${group.bots.length} bots`}
      style={({ pressed }) => ({
        minHeight: splitMode ? MOBILE_SCALE.roster.rowMinHeightSplit : MOBILE_SCALE.roster.rowMinHeight,
        flexDirection: 'row',
        alignItems: 'center',
        gap: splitMode ? 12 : 14,
        paddingHorizontal: 16,
        paddingVertical: splitMode ? 10 : 12,
        opacity: pressed ? 0.72 : 1
      })}
    >
      <GroupAvatarCluster bots={group.bots} size={avatarSize} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <AppText numberOfLines={textLines} ellipsizeMode="tail" style={{ ...MOBILE_SCALE.roster.rowName, flex: 1, fontFamily: 'Inter_600SemiBold' }}>
            {group.purpose}
          </AppText>
          <AppText variant="meta" color={theme.mutedForeground}>
            R{group.round}
          </AppText>
          <WorkingSpinner color={theme.primary} size={14} />
        </View>
        <AppText color={theme.mutedForeground} numberOfLines={textLines} ellipsizeMode="tail" style={{ ...MOBILE_SCALE.roster.rowPreview, fontFamily: 'Inter_400Regular' }}>
          Working together · {group.bots.length} bots
        </AppText>
      </View>
    </Pressable>
  )
}

function GroupAvatarCluster({ bots, size }: { bots: Bot[]; size: number }) {
  const theme = useTheme()
  if (bots.length <= 1 && bots[0]) return <BotAvatar name={bots[0].name} avatar={bots[0].prefs.avatar} size={size} />
  const cell = Math.floor((size - 6) / 2)
  return (
    <View style={{ width: size, height: size, borderRadius: 10, backgroundColor: theme.muted, flexDirection: 'row', flexWrap: 'wrap', padding: 2, gap: 2 }}>
      {bots.slice(0, 4).map(bot => (
        <BotAvatar key={bot.id} name={bot.name} avatar={bot.prefs.avatar} size={cell} />
      ))}
    </View>
  )
}
