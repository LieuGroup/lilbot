/** Settings inline section for General > Delete defaults (`R3-07a`): Bot files (`Archive | Delete`) and
 *  Private memories (`Forget | Keep`), mirroring `web/src/settings/settings-dialog.tsx`. */
import { useCallback, useEffect, useState } from 'react'
import { useWindowDimensions, View } from 'react-native'
import type { BotDeleteDefaults } from '../../../../shared/bot-delete-schema'
import { messageOf } from '../../../../shared/client/socket'
import { ensureSocket } from '../../connection/lilbot'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../../ui/dynamic-type'
import { RowDivider, SectionGroup, SegmentedChoice } from '../../ui/grouped-card'
import { AppText } from '../../ui/text'
import { useTheme } from '../../ui/theme'
import { MOBILE_SCALE } from '../../ui/tokens'
import type { SettingsSectionDefinition, SettingsSectionProps } from '../sections'

const FILES_OPTIONS: readonly { value: BotDeleteDefaults['files']; label: string }[] = [
  { value: 'archive', label: 'Archive' },
  { value: 'delete', label: 'Delete' }
]

const MEMORIES_OPTIONS: readonly { value: BotDeleteDefaults['privateMemories']; label: string }[] = [
  { value: 'forget', label: 'Forget' },
  { value: 'keep', label: 'Keep' }
]

function GeneralSettingsSection({ connected }: SettingsSectionProps) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stackWide = fontScale >= 1.35
  const rowLines = rosterRowTextLines(fontScale)
  const [defaults, setDefaults] = useState<BotDeleteDefaults | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    try {
      setDefaults(await socket.call('bots.deleteDefaults.get', {}))
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [connected])

  useEffect(() => {
    void load()
  }, [load])

  const update = async (patch: Partial<BotDeleteDefaults>) => {
    const socket = ensureSocket()
    if (!socket || !defaults || saving) return
    const next: BotDeleteDefaults = { ...defaults, ...patch }
    const previous = defaults
    setDefaults(next)
    setSaving(true)
    setError('')
    try {
      setDefaults(await socket.call('bots.deleteDefaults.set', next))
    } catch (failure) {
      setDefaults(previous)
      setError(messageOf(failure))
    } finally {
      setSaving(false)
    }
  }

  const filesChoice = defaults?.files ?? 'archive'
  const memoriesChoice = defaults?.privateMemories ?? 'forget'
  const rowStyle = {
    flexDirection: stackWide ? ('column' as const) : ('row' as const),
    alignItems: stackWide ? ('flex-start' as const) : ('center' as const),
    justifyContent: 'space-between' as const,
    minHeight: 60,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: stackWide ? 10 : 12
  }

  return (
    <View style={{ gap: 6 }}>
      <SectionGroup title="Delete defaults" footer="What deleting a bot pre-selects. You can still change either choice when you delete.">
        <View style={rowStyle}>
          <View style={{ flex: stackWide ? 0 : 1, gap: 2 }}>
            <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
              Bot files
            </AppText>
            <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              {filesChoice === 'archive' ? 'Move to archive' : 'Delete permanently'}
            </AppText>
          </View>
          <SegmentedChoice
            value={filesChoice}
            options={FILES_OPTIONS}
            disabled={!connected || !defaults || saving}
            accessibilityLabel="Bot files delete default"
            onChange={files => void update({ files })}
          />
        </View>
        <RowDivider />
        <View style={rowStyle}>
          <View style={{ flex: stackWide ? 0 : 1, gap: 2 }}>
            <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
              Private memories
            </AppText>
            <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              {memoriesChoice === 'forget' ? 'Shared facts stay' : 'Keep private memories'}
            </AppText>
          </View>
          <SegmentedChoice
            value={memoriesChoice}
            options={MEMORIES_OPTIONS}
            disabled={!connected || !defaults || saving}
            accessibilityLabel="Private memories delete default"
            onChange={privateMemories => void update({ privateMemories })}
          />
        </View>
      </SectionGroup>
      {error ? (
        <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
          {error}
        </AppText>
      ) : null}
    </View>
  )
}

export const generalSettingsSection: SettingsSectionDefinition = {
  id: 'general',
  order: 40,
  group: 'inline',
  Component: GeneralSettingsSection
}
