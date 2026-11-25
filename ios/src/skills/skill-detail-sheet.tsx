/** Read-only Skill detail pageSheet: description, per-bot switch, metadata facts, and file tabs (`skills.read`)
 *  sized on `MOBILE_SCALE.details`. */
import { useEffect, useState } from 'react'
import { Modal, Platform, Pressable, ScrollView, Switch, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Skill } from '../../../shared/skills-schema'
import { fileOrder, writtenBy } from '../../../shared/client/skills/skill-lines'
import { messageOf } from '../../../shared/client/socket'
import { useBotStore } from '../bots/store'
import { ensureSocket } from '../connection/lilbot'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { sessionTime } from '../ui/format-time'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })

export function SkillDetailSheet({
  botId,
  botName,
  skill,
  onClose,
  onToggle
}: {
  botId: string
  botName: string
  skill: Skill | null
  onClose: () => void
  onToggle: (name: string, enabled: boolean) => Promise<void>
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const bots = useBotStore(state => state.bots)
  const [files, setFiles] = useState<Record<string, string> | null>(null)
  const [fileError, setFileError] = useState('')
  const [activeFile, setActiveFile] = useState('SKILL.md')
  const [toggleError, setToggleError] = useState('')

  useEffect(() => {
    if (!skill) {
      setFiles(null)
      setFileError('')
      setToggleError('')
      return
    }
    const socket = ensureSocket()
    if (!socket) return
    let active = true
    setFiles(null)
    setFileError('')
    socket
      .call('skills.read', { botId, name: skill.name })
      .then(result => {
        if (active) setFiles(result)
      })
      .catch(failure => {
        if (active) setFileError(messageOf(failure))
      })
    return () => {
      active = false
    }
  }, [botId, skill])

  const paths = files ? fileOrder(Object.keys(files)) : []
  const shown = files && activeFile in files ? activeFile : paths[0]

  return (
    <Modal visible={skill !== null} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={[MOBILE_SCALE.details.sheetTitle, { flex: 1 }]}>
            {skill?.name ?? 'Skill'}
          </AppText>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
            <CloseIcon color={theme.foreground} size={16} />
          </Pressable>
        </View>
        {skill ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: Math.max(32, insets.bottom + 16) }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingHorizontal: 2 }}>
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.body, { flex: 1 }]}>
                {skill.description}
              </AppText>
              <Switch
                value={skill.enabled && !skill.excluded}
                disabled={skill.excluded}
                onValueChange={on => {
                  setToggleError('')
                  void onToggle(skill.name, on).catch(failure => setToggleError(messageOf(failure)))
                }}
                trackColor={{ false: theme.muted, true: theme.foreground }}
                thumbColor={theme.card}
                accessibilityLabel={`${skill.enabled ? 'Turn off' : 'Turn on'} ${skill.name} for ${botName}`}
              />
            </View>
            {toggleError ? (
              <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {toggleError}
              </AppText>
            ) : null}
            <SectionGroup title="About">
              <Fact label="Written by" value={writtenBy(skill.origin, id => bots.find(b => b.id === id)?.name)} />
              <RowDivider />
              <Fact label="Last changed" value={sessionTime(skill.updatedAt)} />
              <RowDivider />
              <Fact label={`For ${botName}`} value={skill.excluded ? 'Hidden by engine' : skill.enabled ? 'On' : 'Off'} />
            </SectionGroup>
            {fileError ? (
              <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {fileError}
              </AppText>
            ) : null}
            {files && shown !== undefined ? (
              <View style={{ gap: 10 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {paths.map(path => {
                    const selected = path === shown
                    return (
                      <Pressable
                        key={path}
                        onPress={() => setActiveFile(path)}
                        accessibilityRole="tab"
                        accessibilityState={{ selected }}
                        style={{ minHeight: 36, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, justifyContent: 'center', backgroundColor: selected ? theme.foreground : theme.card, borderWidth: 1, borderColor: selected ? theme.foreground : theme.hairline }}
                      >
                        <AppText variant="meta" color={selected ? theme.background : theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.tabLabel} style={[MOBILE_SCALE.details.code, { fontFamily: MONO_FONT }]}>
                          {path}
                        </AppText>
                      </Pressable>
                    )
                  })}
                </ScrollView>
                <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 14 }}>
                  <AppText style={[MOBILE_SCALE.details.code, { fontFamily: MONO_FONT }]} selectable>
                    {files[shown]}
                  </AppText>
                </View>
              </View>
            ) : null}
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
              Read-only here. Ask a bot to change it.
            </AppText>
          </ScrollView>
        ) : null}
      </View>
    </Modal>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 12, gap: 12 }}>
      <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
        {label}
      </AppText>
      <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowSubtitle, { flexShrink: 1, textAlign: 'right' }]}>
        {value}
      </AppText>
    </View>
  )
}
