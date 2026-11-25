/** Native stack inside the Settings tab: `index` (Settings home) pushes `[section]` for any
 *  registered Settings section with a `DetailScreen` (Computers, future Notifications/Memory). */
import { Stack } from 'expo-router'
import { useTheme } from '../../../ui/theme'

export default function SettingsStackLayout() {
  const theme = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.foreground,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: theme.background }
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings', headerLargeTitle: true }} />
      <Stack.Screen name="[section]" options={{ title: '' }} />
    </Stack>
  )
}
