/** Setup tab's Skills section: shared skills search, memoized per-bot ink switches, and SkillDetailSheet
 *  sized on `MOBILE_SCALE.details` with Dynamic Type reflow. */
import { Fragment, memo, useCallback, useState } from 'react'
import { Keyboard, Pressable, Switch, TextInput, useWindowDimensions, View } from 'react-native'
import type { Skill } from '../../../shared/skills-schema'
import { matchesSkill, skillCount } from '../../../shared/client/skills/skill-lines'
import { messageOf } from '../../../shared/client/socket'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../ui/dynamic-type'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import type { FormFieldFocus } from '../ui/use-reveal-above-keyboard'
import { SkillDetailSheet } from './skill-detail-sheet'
import { useSkills } from './use-skills'

export function SkillsSection({ botId, botName, field }: { botId: string; botName: string; field?: FormFieldFocus }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const rowLines = rosterRowTextLines(fontScale)
  const { skills, error, setEnabled } = useSkills(botId)
  const [query, setQuery] = useState('')
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [failure, setFailure] = useState('')

  const shown = skills?.filter(skill => matchesSkill(skill, query)) ?? []
  const selected = skills?.find(skill => skill.name === selectedName) ?? null
  const count = skills ? skillCount(skills, shown.length, query.trim() !== '') : undefined

  const handleToggle = useCallback(
    (name: string, enabled: boolean) => {
      setFailure('')
      void setEnabled(name, enabled).catch(cause => setFailure(messageOf(cause)))
    },
    [setEnabled]
  )

  const handleSelect = useCallback((name: string) => setSelectedName(name), [])

  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, gap: 8 }}>
        <AppText variant="name" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader} style={MOBILE_SCALE.details.sectionHeader}>
          Skills
        </AppText>
        {count ? (
          <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader} style={MOBILE_SCALE.details.sectionHeader}>
            {count}
          </AppText>
        ) : null}
      </View>

      {!skills ? (
        <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
          {error || 'Loading…'}
        </AppText>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 46, borderRadius: 12, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline }}>
            <SearchIcon color={theme.mutedForeground} size={16} />
            <TextInput
              testID="skills-search-input"
              onFocus={field?.onFocus}
              onBlur={field?.onBlur}
              value={query}
              onChangeText={setQuery}
              placeholder="Find a skill"
              placeholderTextColor={theme.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => Keyboard.dismiss()}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}
              style={{ flex: 1, fontFamily: 'Inter_400Regular', fontSize: MOBILE_SCALE.details.input.fontSize, lineHeight: MOBILE_SCALE.details.input.lineHeight, color: theme.foreground, paddingVertical: 8 }}
            />
          </View>

          {shown.length > 0 ? (
            <SectionGroup title="" footer={`All bots share these skills. A switch here only affects ${botName}, from its next session.`}>
              {shown.map((skill, index) => (
                <Fragment key={skill.name}>
                  {index > 0 ? <RowDivider /> : null}
                  <SkillRow skill={skill} rowLines={rowLines} onSelect={handleSelect} onToggle={handleToggle} />
                </Fragment>
              ))}
            </SectionGroup>
          ) : query.trim() ? (
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
              No skill matches “{query.trim()}”. Ask a bot to write one.
            </AppText>
          ) : null}

          {failure ? (
            <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
              {failure}
            </AppText>
          ) : null}
        </>
      )}

      <SkillDetailSheet botId={botId} botName={botName} skill={selected} onClose={() => setSelectedName(null)} onToggle={setEnabled} />
    </View>
  )
}

const SkillRow = memo(function SkillRow({
  skill,
  rowLines,
  onSelect,
  onToggle
}: {
  skill: Skill
  rowLines: 1 | 2
  onSelect: (name: string) => void
  onToggle: (name: string, enabled: boolean) => void
}) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingRight: 12 }}>
      <Pressable
        onPress={() => onSelect(skill.name)}
        accessibilityRole="button"
        style={({ pressed }) => ({ flex: 1, minWidth: 0, paddingVertical: 12, paddingLeft: 14, gap: 3, opacity: pressed ? 0.65 : 1 })}
      >
        <AppText variant="name" color={skill.excluded ? theme.mutedForeground : theme.foreground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          {skill.name}
        </AppText>
        <AppText variant="preview" color={theme.mutedForeground} numberOfLines={2} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
          {skill.description}
        </AppText>
      </Pressable>
      <Switch
        value={skill.enabled && !skill.excluded}
        disabled={skill.excluded}
        onValueChange={on => onToggle(skill.name, on)}
        trackColor={{ false: theme.muted, true: theme.foreground }}
        thumbColor={theme.card}
        accessibilityLabel={`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name}`}
      />
    </View>
  )
})
