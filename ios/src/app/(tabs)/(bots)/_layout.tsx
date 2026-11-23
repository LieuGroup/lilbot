/** Native stack inside the Bots tab: `index` (Roster / unfolded Split) pushes `chat` (compact Chat)
 *  so UIKit provides its own left-edge interactive pop gesture, Duo side-strip Back, and Assistive Access Back. */
import { Stack } from 'expo-router'
import { useTheme } from '../../../ui/theme'

export default function BotsStackLayout() {
  const theme = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerShadowVisible: false,
        gestureEnabled: true,
        contentStyle: { backgroundColor: theme.background }
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="chat" options={{ headerShown: true, gestureEnabled: true }} />
    </Stack>
  )
}
