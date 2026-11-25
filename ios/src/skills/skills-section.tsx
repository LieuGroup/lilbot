/** Setup tab's Skills section: shared skills search, per-bot ink switches, and tap-to-read SkillDetailSheet. */
import { Fragment, useState } from 'react'
import { Keyboard, Pressable, Switch, TextInput, View } from 'react-native'
import { matchesSkill, skillCount } from '../../../shared/client/skills/skill-lines'
import { messageOf } from '../../../shared/client/socket'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { SkillDetailSheet } from './skill-detail-sheet'
import { useSkills } from './use-skills'

export function SkillsSection({ botId, botName }: { botId: string; botName: string }) {
  const theme = useTheme()
  const { skills, error, setEnabled } = useSkills(botId)
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [failure, setFailure] = useState('')

  const shown = skills?.filter(skill => matchesSkill(skill, query)) ?? []
  const selected = skills?.find(skill => skill.name === selectedName) ?? null
  const count = skills ? skillCount(skills, shown.length, query.trim() !== '') : undefined

  const handleToggle = (name: string, enabled: boolean) => {
    setFailure('')
    void setEnabled(name, enabled).catch(cause => setFailure(messageOf(cause)))
  }

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
        <AppText variant="meta" color={theme.mutedForeground}>
          Skills
        </AppText>
        {count ? (
          <AppText variant="meta" color={theme.mutedForeground}>
            {count}
          </AppText>
        ) : null}
      </View>

      {!skills ? (
        <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground} style={{ paddingHorizontal: 4 }}>
          {error || 'Loading…'}
        </AppText>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 40, borderRadius: 12, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
            <SearchIcon color={theme.mutedForeground} size={15} />
            <TextInput
              testID="skills-search-input"
              value={query}
              onChangeText={setQuery}
              placeholder="Find a skill"
              placeholderTextColor={theme.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => Keyboard.dismiss()}
              style={{ flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.foreground, paddingVertical: 8 }}
            />
          </View>

          {shown.length > 0 ? (
            <SectionGroup title="" footer={`All bots share these skills. A switch here only affects ${botName}, from its next session.`}>
              {shown.map((skill, index) => (
                <Fragment key={skill.name}>
                  {index > 0 ? <RowDivider /> : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12 }}>
                    <Pressable
                      onPress={() => setSelectedName(skill.name)}
                      accessibilityRole="button"
                      style={({ pressed }) => ({ flex: 1, minWidth: 0, paddingVertical: 11, paddingLeft: 14, gap: 2, opacity: pressed ? 0.65 : 1 })}
                    >
                      <AppText variant="preview" color={skill.excluded ? theme.mutedForeground : theme.foreground} style={{ fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                        {skill.name}
                      </AppText>
                      <AppText variant="meta" color={theme.mutedForeground} numberOfLines={2}>
                        {skill.description}
                      </AppText>
                    </Pressable>
                    <Switch
                      value={skill.enabled && !skill.excluded}
                      disabled={skill.excluded}
                      onValueChange={on => handleToggle(skill.name, on)}
                      trackColor={{ false: theme.muted, true: theme.foreground }}
                      thumbColor={theme.card}
                      accessibilityLabel={`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`}
                    />
                  </View>
                </Fragment>
              ))}
            </SectionGroup>
          ) : query.trim() ? (
            <AppText variant="preview" color={theme.mutedForeground} style={{ paddingHorizontal: 4 }}>
              No skill matches “{query.trim()}”. Ask a bot to write one.
            </AppText>
          ) : null}

          {failure ? (
            <AppText variant="meta" color={theme.destructive} style={{ paddingHorizontal: 4 }}>
              {failure}
            </AppText>
          ) : null}
        </>
      )}

      <SkillDetailSheet botId={botId} botName={botName} skill={selected} onClose={() => setSelectedName(null)} onToggle={setEnabled} />
    </View>
  )
}
