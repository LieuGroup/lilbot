/** Native stack inside the Bots tab so UIKit manages headers, Duo side-strip bar items, and Assistive Access Back. */
import { Stack } from 'expo-router'
import { useTheme } from '../../../ui/theme'

export default function BotsStackLayout() {
  const theme = useTheme()
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.background }
      }}
    />
  )
}
