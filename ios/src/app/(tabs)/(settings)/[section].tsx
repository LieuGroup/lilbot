/** Dynamic pushed screen for any registered Settings section with `routeName` + `DetailScreen`
 *  (e.g. `computers`, future `notifications` or `memory`), honoring Duo horizontal strip clearance. */
import { Stack, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { computeShellLayout } from '../../../duo/layout'
import { useLiveSurface } from '../../../duo/use-surface'
import { findSettingsSectionRoute } from '../../../settings/sections'
import { SETTINGS_SECTIONS } from '../../../settings/sections/index'
import { AppText } from '../../../ui/text'
import { useTheme } from '../../../ui/theme'

export default function SettingsSectionRoute() {
  const theme = useTheme()
  const { surface, metrics } = useLiveSurface()
  const layout = computeShellLayout(surface, metrics)
  const params = useLocalSearchParams<{ section?: string }>()
  const name = typeof params.section === 'string' ? params.section : undefined
  const entry = findSettingsSectionRoute(SETTINGS_SECTIONS, name)
  const Detail = entry?.DetailScreen

  return (
    <>
      <Stack.Screen options={{ title: entry?.routeTitle ?? 'Settings' }} />
      <View style={{ flex: 1, backgroundColor: theme.background, paddingLeft: layout.horizontalPadding.left, paddingRight: layout.horizontalPadding.right }}>
        {Detail ? (
          <Detail />
        ) : (
          <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <AppText variant="preview" color={theme.mutedForeground}>
              This settings section is not available.
            </AppText>
          </View>
        )}
      </View>
    </>
  )
}
