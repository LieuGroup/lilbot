/** Settings tab root screen inside the `(settings)` native stack, honoring Duo horizontal strip clearance. */
import { Stack, useRouter } from 'expo-router'
import { useCallback } from 'react'
import { View } from 'react-native'
import { computeShellLayout } from '../../../duo/layout'
import { useLiveSurface } from '../../../duo/use-surface'
import { SettingsScreen } from '../../../settings/screen'
import { useTheme } from '../../../ui/theme'
import { useKeyboardHeight } from '../../../ui/use-keyboard-height'
import { useFoldChromeWhileTyping } from '../../../ui/use-reveal-above-keyboard'

export default function SettingsIndexRoute() {
  const theme = useTheme()
  const router = useRouter()
  const { surface, metrics } = useLiveSurface()
  const layout = computeShellLayout(surface, metrics)
  const foldChrome = useFoldChromeWhileTyping(useKeyboardHeight())
  const handleNavigateSection = useCallback(
    (routeName: string) => {
      router.push({ pathname: '/(tabs)/(settings)/[section]', params: { section: routeName } })
    },
    [router]
  )
  return (
    <View style={{ flex: 1, backgroundColor: theme.background, paddingLeft: layout.horizontalPadding.left, paddingRight: layout.horizontalPadding.right }}>
      <Stack.Screen options={{ headerShown: !foldChrome }} />
      <SettingsScreen onNavigateSection={handleNavigateSection} />
    </View>
  )
}
