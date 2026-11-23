/** The bot roster: the primary bot and pinned bots on top, then sections, unassigned and hidden,
 *  in the same order as the web app's roster (shared/client/bots/roster-groups). */
import { Pressable, ScrollView, type ScrollViewProps, View } from 'react-native'
import type { Bot, Section } from '../../../shared/bot-schema'
import { rosterGroups } from '../../../shared/client/bots/roster-groups'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'
import { BotAvatar } from '../ui/avatar'
import { radius } from '../ui/tokens'

interface RosterProps {
  bots: Bot[]
  sections: Section[]
  selectedId: string | null
  onSelect: (bot: Bot) => void
  onOpenSettings?: () => void
  onScroll?: ScrollViewProps['onScroll']
  bottomInset?: number
}

export function Roster({ bots, sections, selectedId, onSelect, onOpenSettings, onScroll, bottomInset = 0 }: RosterProps) {
  const theme = useTheme()
  const groups = rosterGroups(bots, sections)

  return (
    <View style={{ flex: 1 }}>
      {onOpenSettings && (
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 }}>
          <Pressable onPress={onOpenSettings} accessibilityLabel="Settings" style={{ padding: 6 }}>
            <AppText variant="name" color={theme.mutedForeground}>
              Settings
            </AppText>
          </Pressable>
        </View>
      )}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, paddingBottom: 12 + bottomInset, gap: 4 }} onScroll={onScroll} scrollEventThrottle={16}>
        <View style={{ gap: 2 }}>
          {groups.top.map(bot => (
            <RosterRow key={bot.id} bot={bot} selected={bot.id === selectedId} onPress={() => onSelect(bot)} />
          ))}
        </View>
        {groups.sections.map(({ section, bots: group }) => (
          <View key={section.id} style={{ gap: 2, marginTop: 12 }}>
            <SectionLabel name={section.name} />
            {group.map(bot => (
              <RosterRow key={bot.id} bot={bot} selected={bot.id === selectedId} onPress={() => onSelect(bot)} />
            ))}
          </View>
        ))}
        {groups.unassigned.length > 0 && (
          <View style={{ gap: 2, marginTop: 12 }}>
            {groups.sections.length > 0 && <SectionLabel name="Unassigned" />}
            {groups.unassigned.map(bot => (
              <RosterRow key={bot.id} bot={bot} selected={bot.id === selectedId} onPress={() => onSelect(bot)} />
            ))}
          </View>
        )}
        {groups.hidden.length > 0 && (
          <View style={{ gap: 2, marginTop: 12 }}>
            <SectionLabel name="Hidden" />
            {groups.hidden.map(bot => (
              <RosterRow key={bot.id} bot={bot} selected={bot.id === selectedId} onPress={() => onSelect(bot)} />
            ))}
          </View>
        )}
        {bots.length === 0 && (
          <AppText variant="chat" color={theme.mutedForeground} style={{ textAlign: 'center', marginTop: 40 }}>
            No bots yet.
          </AppText>
        )}
      </ScrollView>
    </View>
  )
}

function SectionLabel({ name }: { name: string }) {
  const theme = useTheme()
  return (
    <AppText variant="meta" color={theme.mutedForeground} style={{ paddingHorizontal: 10, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>
      {name}
    </AppText>
  )
}

function RosterRow({ bot, selected, onPress }: { bot: Bot; selected: boolean; onPress: () => void }) {
  const theme = useTheme()
  const working = bot.activity?.status === 'working'
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={bot.name}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: radius.md,
        backgroundColor: selected ? theme.secondary : 'transparent'
      }}
    >
      <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={32} />
      <View style={{ flex: 1 }}>
        <AppText variant="name" numberOfLines={1}>
          {bot.name}
          {bot.isPrimary ? ' ·' : ''}
        </AppText>
        {bot.activity?.text ? (
          <AppText variant="meta" color={theme.mutedForeground} numberOfLines={1}>
            {bot.activity.text}
          </AppText>
        ) : null}
      </View>
      {working && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />}
    </Pressable>
  )
}
