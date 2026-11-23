/** Settings tab root screen: hosts existing SettingsScreen with native tab-bar bottom insets and top safe area. */
import { SafeAreaView } from 'react-native-safe-area-context'
import { SettingsScreen } from '../../settings/screen'
import { useTheme } from '../../ui/theme'

export default function SettingsTabScreen() {
  const theme = useTheme()
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: theme.background }}>
      <SettingsScreen />
    </SafeAreaView>
  )
}
