/** Settings navigation row for Computers (`R3-07a` -> `R3-07b`), summarizing online count and main computer. */
import { Pressable, useWindowDimensions, View } from 'react-native'
import { ComputersScreen } from '../../computers/computers-screen'
import { useComputers } from '../../computers/use-computers'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../../ui/dynamic-type'
import { ChevronRightIcon } from '../../ui/icon'
import { AppText } from '../../ui/text'
import { useTheme } from '../../ui/theme'
import { MOBILE_SCALE } from '../../ui/tokens'
import type { SettingsSectionDefinition, SettingsSectionProps } from '../sections'

function ComputersRow({ navigate, connected }: SettingsSectionProps) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const rowLines = rosterRowTextLines(fontScale)
  const { computers } = useComputers()
  const onlineCount = computers ? computers.filter(c => c.online).length : null
  const mainName = computers?.find(c => c.main)?.name ?? null
  const summary = !connected
    ? 'Offline'
    : onlineCount === null
      ? 'Loading…'
      : mainName
        ? `${onlineCount} online · Main: ${mainName}`
        : `${onlineCount} online`

  return (
    <Pressable
      testID="settings-row-computers"
      onPress={() => navigate('computers')}
      accessibilityRole="button"
      accessibilityLabel={`Computers, ${summary}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 58,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 12,
        opacity: pressed ? 0.65 : 1
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          Computers
        </AppText>
        <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
          {summary}
        </AppText>
      </View>
      <ChevronRightIcon color={theme.mutedForeground} size={15} />
    </Pressable>
  )
}

export const computersSettingsSection: SettingsSectionDefinition = {
  id: 'computers',
  order: 10,
  group: 'navigation',
  routeName: 'computers',
  routeTitle: 'Computers',
  Component: ComputersRow,
  DetailScreen: ComputersScreen
}
