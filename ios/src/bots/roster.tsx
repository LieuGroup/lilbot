/** The bot roster: sections, each bot's badge and name, and its live status dot. */
import { Pressable, ScrollView, View } from 'react-native'
import type { Bot, Section } from '../../../shared/bot-schema'
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
}

export function Roster({ bots, sections, selectedId, onSelect, onOpenSettings }: RosterProps) {
  const theme = useTheme()
  const visible = bots.filter(bot => !bot.prefs.hidden)
  const bySection = new Map<string | null, Bot[]>()
  for (const bot of visible) {
    const key = bot.prefs.sectionId
    bySection.set(key, [...(bySection.get(key) ?? []), bot])
  }
  const ordered = [...sections.map(section => ({ section, bots: bySection.get(section.id) ?? [] })), { section: null, bots: bySection.get(null) ?? [] }].filter(group => group.bots.length > 0)

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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 12, gap: 4 }}>
      {ordered.map(({ section, bots: group }) => (
        <View key={section?.id ?? 'unfiled'} style={{ gap: 2, marginBottom: 12 }}>
          {section && (
            <AppText variant="meta" color={theme.mutedForeground} style={{ paddingHorizontal: 10, paddingBottom: 4, textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {section.name}
            </AppText>
          )}
          {group.map(bot => (
            <RosterRow key={bot.id} bot={bot} selected={bot.id === selectedId} onPress={() => onSelect(bot)} />
          ))}
        </View>
      ))}
      {visible.length === 0 && (
        <AppText variant="chat" color={theme.mutedForeground} style={{ textAlign: 'center', marginTop: 40 }}>
          No bots yet.
        </AppText>
      )}
      </ScrollView>
    </View>
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
