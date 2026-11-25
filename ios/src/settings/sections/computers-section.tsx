/** Settings navigation row for Computers (`R3-07a` -> `R3-07b`), summarizing online count and main computer. */
import { Pressable, View } from 'react-native'
import { ComputersScreen } from '../../computers/computers-screen'
import { useComputers } from '../../computers/use-computers'
import { ChevronRightIcon } from '../../ui/icon'
import { AppText } from '../../ui/text'
import { useTheme } from '../../ui/theme'
import type { SettingsSectionDefinition, SettingsSectionProps } from '../sections'

function ComputersRow({ navigate, connected }: SettingsSectionProps) {
  const theme = useTheme()
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
        minHeight: 52,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: 12,
        opacity: pressed ? 0.65 : 1
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <AppText variant="name">Computers</AppText>
        <AppText variant="meta" color={theme.mutedForeground} numberOfLines={1}>
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
