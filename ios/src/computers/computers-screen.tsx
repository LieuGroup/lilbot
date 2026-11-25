/** Settings > Computers (`R3-07b`): `This device` (Name, Runs on, `deviceLine`), live `Computers` list
 *  (green online dot, 40% muted grey offline dot, `Main` badge, `Make main`, remove confirmation), and
 *  `Add a machine without a screen…`. Zero QR pairing and zero latency readouts. */
import { Fragment, useEffect, useState } from 'react'
import { Alert, Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { type ComputerRow, computerRows } from '../../../shared/client/computers/computer-rows'
import { deviceLine } from '../../../shared/client/devices/device-line'
import { useThisDevice } from '../devices/use-this-device'
import { PillBadge, RowDivider, SectionGroup } from '../ui/grouped-card'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { CommandLineSheet } from './command-line-sheet'
import { RenameDeviceModal, RunsOnSheet } from './device-modals'
import { useComputers } from './use-computers'

const COMPUTERS_FOOTER =
  'Every bot can use every computer here. Computers marked “Coding workers” can run coding tasks on their own. The main computer is used when you write from a phone, or from a device that is not one of these.'

export function ComputersScreen() {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stackWide = fontScale >= 1.35
  const insets = useSafeAreaInsets()
  const { computers, error, setMain, remove } = useComputers()
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
    setRenameOpen(false)
    if (trimmed && trimmed !== thisDevice.device?.name) await thisDevice.rename(trimmed)
  }

  const confirmRemove = (row: ComputerRow) => {
    if (row.isLeader) return
    Alert.alert(`Remove ${row.name}?`, 'Bots will no longer be able to use this computer until you add it again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void remove(row.id) }
    ])
  }

  return (
    <ScrollView
      testID="settings-computers-screen"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: Math.max(32, insets.bottom + 16) }}
    >
      <SectionGroup title="This device" footer={thisDevice.device ? deviceLine(thisDevice.device.resolves) : undefined}>
        <Pressable
          testID="this-device-name-row"
          disabled={!thisDevice.device}
          onPress={() => {
            setNameDraft(thisDevice.device?.name ?? '')
            setRenameOpen(true)
          }}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: stackWide ? 'column' : 'row', alignItems: stackWide ? 'flex-start' : 'center', justifyContent: 'space-between', minHeight: 46, paddingHorizontal: 14, paddingVertical: 10, gap: stackWide ? 4 : 12, opacity: pressed ? 0.65 : 1 })}
        >
          <AppText variant="name">Name</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <AppText variant="preview" color={theme.mutedForeground} numberOfLines={stackWide ? 2 : 1}>
              {thisDevice.device?.name ?? 'Loading…'}
            </AppText>
            <ChevronRightIcon color={theme.mutedForeground} size={14} />
          </View>
        </Pressable>
        <RowDivider />
        <Pressable
          testID="this-device-runs-on-row"
          disabled={!thisDevice.device}
          onPress={() => setRunsOnOpen(true)}
          accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: stackWide ? 'column' : 'row', alignItems: stackWide ? 'flex-start' : 'center', justifyContent: 'space-between', minHeight: 46, paddingHorizontal: 14, paddingVertical: 10, gap: stackWide ? 4 : 12, opacity: pressed ? 0.65 : 1 })}
        >
          <AppText variant="name">Runs on</AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
            <AppText variant="preview" color={theme.mutedForeground} numberOfLines={stackWide ? 2 : 1}>
              {linkedName}
            </AppText>
            <ChevronRightIcon color={theme.mutedForeground} size={14} />
          </View>
        </Pressable>
      </SectionGroup>

      {thisDevice.error ? (
        <AppText variant="meta" color={theme.destructive}>
          {thisDevice.error}
        </AppText>
      ) : null}

      <SectionGroup title="Computers" footer={COMPUTERS_FOOTER}>
        {rows.length === 0 ? (
          <View style={{ paddingHorizontal: 14, paddingVertical: 14 }}>
            <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground}>
              {error || 'Loading…'}
            </AppText>
          </View>
        ) : (
          rows.map((row, index) => (
            <Fragment key={row.id}>
              {index > 0 ? <RowDivider /> : null}
              <Pressable onLongPress={() => confirmRemove(row)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, minHeight: 54 }}>
                <View
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: row.status === 'online' ? theme.success : row.status === 'conflict' ? theme.destructive : theme.mutedForeground,
                    opacity: row.status === 'offline' ? 0.4 : 1
                  }}
                />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <AppText variant="name" numberOfLines={1}>
                      {row.name}
                    </AppText>
                    {row.main ? <PillBadge label="Main" /> : null}
                  </View>
                  <AppText variant="meta" color={row.status === 'conflict' ? theme.destructive : theme.mutedForeground} numberOfLines={2}>
                    {row.line}
                    {row.workerText ? ` · ${row.workerText}` : ''}
                    {row.thisDevice ? ' · This device' : ''}
                  </AppText>
                </View>
                {!row.main && row.status !== 'conflict' ? (
                  <Pressable
                    onPress={() => void setMain(row.id)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Make ${row.name} main`}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 32, paddingHorizontal: 6, opacity: pressed ? 0.6 : 1 })}
                  >
                    <AppText variant="preview" color={theme.mutedForeground}>
                      Make main
                    </AppText>
                    <ChevronRightIcon color={theme.mutedForeground} size={13} />
                  </Pressable>
                ) : null}
              </Pressable>
            </Fragment>
          ))
        )}
      </SectionGroup>

      <Pressable
        testID="add-machine-command-line"
        onPress={() => setCommandLineOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 48,
          paddingHorizontal: 14,
          borderRadius: 14,
          backgroundColor: theme.card,
          borderWidth: 1,
          borderColor: theme.hairline,
          opacity: pressed ? 0.65 : 1
        })}
      >
        <AppText variant="name">Add a machine without a screen…</AppText>
        <ChevronRightIcon color={theme.mutedForeground} size={14} />
      </Pressable>

      <RenameDeviceModal visible={renameOpen} draft={nameDraft} onChangeDraft={setNameDraft} onCancel={() => setRenameOpen(false)} onSave={() => void saveRename()} />
      <RunsOnSheet
        visible={runsOnOpen}
        computers={computers ?? []}
        selectedId={thisDevice.device?.computerId ?? null}
        onClose={() => setRunsOnOpen(false)}
        onSelect={id => {
          setRunsOnOpen(false)
          void thisDevice.link(id)
        }}
      />
      <CommandLineSheet visible={commandLineOpen} onClose={() => setCommandLineOpen(false)} />
    </ScrollView>
  )
}
