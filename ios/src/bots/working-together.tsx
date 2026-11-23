/** Active temporary groups ("Working together") shown above user sections whenever a group runs (R4-03a / R4-01a / R4-02a).
 *  Driven directly by `runningGroups(bots)` from `shared/client/bots/running-groups.ts`. */
import { Pressable, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { type RunningGroup, runningGroups } from '../../../shared/client/bots/running-groups'
import { BotAvatar } from '../ui/avatar'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { WorkingSpinner } from './status-marks'

interface WorkingTogetherProps {
  bots: Bot[]
  compactCardSurface: boolean
  onSelectBot: (bot: Bot) => void
}

export function WorkingTogether({ bots, compactCardSurface, onSelectBot }: WorkingTogetherProps) {
  const theme = useTheme()
  const groups = runningGroups(bots)
  if (groups.length === 0) return null

  return (
    <View style={{ paddingHorizontal: compactCardSurface ? 12 : 0, marginBottom: 8 }}>
      <View
        style={
          compactCardSurface
            ? { backgroundColor: theme.card, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }
            : { borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.hairline }
        }
      >
        {groups.map((group, index) => (
          <GroupRow key={group.id} group={group} showDivider={index > 0} compactCardSurface={compactCardSurface} onSelectBot={onSelectBot} />
        ))}
      </View>
    </View>
  )
}

function GroupRow({ group, showDivider, compactCardSurface, onSelectBot }: { group: RunningGroup; showDivider: boolean; compactCardSurface: boolean; onSelectBot: (bot: Bot) => void }) {
  const theme = useTheme()
  const leader = group.bots[0]
  return (
    <Pressable
      testID={`working-group-${group.id}`}
      onPress={() => leader && onSelectBot(leader)}
      accessibilityRole="button"
      accessibilityLabel={`Working together: ${group.purpose}, Round ${group.round}, ${group.bots.length} bots`}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: compactCardSurface ? 12 : 16,
        paddingVertical: 8,
        borderTopWidth: showDivider ? 1 : 0,
        borderTopColor: theme.hairline,
        opacity: pressed ? 0.72 : 1
      })}
    >
      <GroupAvatarCluster bots={group.bots} />
      <AppText variant="name" numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, fontFamily: 'Inter_500Medium' }}>
        {group.purpose}
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <AppText variant="meta" color={theme.mutedForeground}>
          R{group.round}
        </AppText>
        <WorkingSpinner color={theme.primary} size={14} />
      </View>
    </Pressable>
  )
}

function GroupAvatarCluster({ bots }: { bots: Bot[] }) {
  const theme = useTheme()
  if (bots.length <= 1 && bots[0]) return <BotAvatar name={bots[0].name} avatar={bots[0].prefs.avatar} size={28} />
  return (
    <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: theme.muted, flexDirection: 'row', flexWrap: 'wrap', padding: 1.5, gap: 1 }}>
      {bots.slice(0, 4).map(bot => (
        <BotAvatar key={bot.id} name={bot.name} avatar={bot.prefs.avatar} size={12} />
      ))}
    </View>
  )
}
