/** Settings tab root screen inside the `(settings)` native stack, honoring Duo horizontal strip clearance. */
import { useRouter } from 'expo-router'
import { useCallback } from 'react'
import { View } from 'react-native'
import { computeShellLayout } from '../../../duo/layout'
import { useLiveSurface } from '../../../duo/use-surface'
import { SettingsScreen } from '../../../settings/screen'
import { useTheme } from '../../../ui/theme'

export default function SettingsIndexRoute() {
  const theme = useTheme()
  const router = useRouter()
  const { surface, metrics } = useLiveSurface()
  const layout = computeShellLayout(surface, metrics)
  const handleNavigateSection = useCallback(
    (routeName: string) => {
      router.push({ pathname: '/(tabs)/(settings)/[section]', params: { section: routeName } })
    },
    [router]
  )
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingLeft: layout.horizontalPadding.left, paddingRight: layout.horizontalPadding.right }}>
      <SettingsScreen onNavigateSection={handleNavigateSection} />
    </View>
  )
}
