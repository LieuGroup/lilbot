/** Settings > Computers (`R3-07b`): `This device` (Name, Runs on, `deviceLine`), live `Computers` list
 *  (with visible `Make main` and VoiceOver-reachable `Remove` buttons + action error banner), and
 *  `Add a machine without a screen…`. */
import { Fragment, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type ComputerRow, computerRows } from '../../../shared/client/computers/computer-rows'
import { deviceLine } from '../../../shared/client/devices/device-line'
import { useThisDevice } from '../devices/use-this-device'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../ui/dynamic-type'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { CommandLineSheet } from './command-line-sheet'
import { ComputerRowCard } from './computer-row-card'
import { RenameDeviceModal, RunsOnSheet } from './device-modals'
import { useComputers } from './use-computers'

const COMPUTERS_FOOTER =
  'Every bot can use every computer here. Computers marked “Coding workers” can run coding tasks on their own. The main computer is used when you write from a phone, or from a device that is not one of these.'

export function ComputersScreen() {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stackWide = fontScale >= 1.35
  const rowLines = rosterRowTextLines(fontScale)
  const insets = useSafeAreaInsets()
  const { computers, error, busyId, setMain, remove } = useComputers()
  const thisDevice = useThisDevice()
  const [now, setNow] = useState(() => Date.now())
  const [renameOpen, setRenameOpen] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [runsOnOpen, setRunsOnOpen] = useState(false)
  const [commandLineOpen, setCommandLineOpen] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const rows = computers ? computerRows(computers, now, thisDevice.device?.computerId) : []
  const linkedName = computers?.find(c => c.id === thisDevice.device?.computerId)?.name ?? 'Not one of these'

  const saveRename = async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed) return
    setRenameOpen(false)
    if (trimmed !== thisDevice.device?.name) await thisDevice.rename(trimmed)
  }

  const confirmRemove = (row: ComputerRow) => {
    if (row.isLeader || busyId !== null) return
    Alert.alert(`Remove ${row.name}?`, 'Bots will no longer be able to use this computer until you add it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove(row.id) }
    ])
  }

  const deviceRowStyle = {
    flexDirection: stackWide ? ('column' as const) : ('row' as const),
    alignItems: stackWide ? ('flex-start' as const) : ('center' as const),
    justifyContent: 'space-between' as const,
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: stackWide ? 4 : 12
  }

  return (
    <ScrollView
      testID="settings-computers-screen"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: Math.max(32, insets.bottom + 16) }}
    >
      <SectionGroup title="This device" footer={thisDevice.device ? deviceLine(thisDevice.device.resolves) : undefined}>
        <Pressable testID="this-device-name-row" disabled={!thisDevice.device} onPress={() => { setNameDraft(thisDevice.device?.name ?? ''); setRenameOpen(true) }} accessibilityRole="button" style={({ pressed }) => ({ ...deviceRowStyle, opacity: pressed ? 0.65 : 1 })}>
          <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
            Name
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              {thisDevice.device?.name ?? 'Loading…'}
            </AppText>
            <ChevronRightIcon color={theme.mutedForeground} size={15} />
          </View>
        </Pressable>
        <RowDivider />
        <Pressable testID="this-device-runs-on-row" disabled={!thisDevice.device} onPress={() => setRunsOnOpen(true)} accessibilityRole="button" style={({ pressed }) => ({ ...deviceRowStyle, opacity: pressed ? 0.65 : 1 })}>
          <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
            Runs on
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              {linkedName}
            </AppText>
            <ChevronRightIcon color={theme.mutedForeground} size={15} />
          </View>
        </Pressable>
      </SectionGroup>

      {thisDevice.error ? (
        <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
          {thisDevice.error}
        </AppText>
      ) : null}

      <SectionGroup title="Computers" footer={COMPUTERS_FOOTER}>
        {rows.length === 0 ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
            <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              {error || 'Loading…'}
            </AppText>
          </View>
        ) : (
          rows.map((row, index) => (
            <Fragment key={row.id}>
              {index > 0 ? <RowDivider /> : null}
              <ComputerRowCard row={row} rowLines={rowLines} busy={busyId !== null} onSetMain={id => void setMain(id)} onRemove={confirmRemove} />
            </Fragment>
          ))
        )}
      </SectionGroup>

      {rows.length > 0 && error ? (
        <AppText testID="computers-action-error" variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
          {error}
        </AppText>
      ) : null}

      <Pressable
        testID="add-machine-command-line"
        onPress={() => setCommandLineOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 54, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, opacity: pressed ? 0.65 : 1 })}
      >
        <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
          Add a machine without a screen…
        </AppText>
        <ChevronRightIcon color={theme.mutedForeground} size={15} />
      </Pressable>

      <RenameDeviceModal visible={renameOpen} draft={nameDraft} onChangeDraft={setNameDraft} onCancel={() => setRenameOpen(false)} onSave={() => void saveRename()} />
      <RunsOnSheet visible={runsOnOpen} computers={computers ?? []} selectedId={thisDevice.device?.computerId ?? null} onClose={() => setRunsOnOpen(false)} onSelect={id => { setRunsOnOpen(false); void thisDevice.link(id) }} />
      <CommandLineSheet visible={commandLineOpen} onClose={() => setCommandLineOpen(false)} />
    </ScrollView>
  )
}
