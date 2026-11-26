/** Settings navigation row for Memory (slot 30), pushing Settings > Memory: what the bots remember, in one place. */
import { Pressable, useWindowDimensions, View } from 'react-native'
import { MemoryScreen } from '../../memory/memory-screen'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../../ui/dynamic-type'
import { ChevronRightIcon } from '../../ui/icon'
import { AppText } from '../../ui/text'
import { useTheme } from '../../ui/theme'
import { MOBILE_SCALE } from '../../ui/tokens'
import type { SettingsSectionDefinition, SettingsSectionProps } from '../sections'

function MemoryRow({ navigate }: SettingsSectionProps) {
  const theme = useTheme()
  const rowLines = rosterRowTextLines(useWindowDimensions().fontScale)
  return (
    <Pressable
      testID="settings-row-memory"
      onPress={() => navigate('memory')}
      accessibilityRole="button"
      accessibilityLabel="Memory, what your bots remember"
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 58, paddingHorizontal: 14, paddingVertical: 12, gap: 12, opacity: pressed ? 0.65 : 1 })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          Memory
        </AppText>
        <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
          What your bots remember
        </AppText>
      </View>
      <ChevronRightIcon color={theme.mutedForeground} size={15} />
    </Pressable>
  )
}

export const memorySettingsSection: SettingsSectionDefinition = {
  id: 'memory',
  order: 30,
  group: 'navigation',
  routeName: 'memory',
  routeTitle: 'Memory',
  Component: MemoryRow,
  DetailScreen: MemoryScreen
}
