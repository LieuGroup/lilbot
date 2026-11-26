/** Native stack inside the Work tab: `index` (Work board) pushes `item` (Work item detail)
 *  with native swipe-back and Duo side-strip Back support. */
import { Stack } from 'expo-router'
import { useTheme } from '../../../ui/theme'

export const unstable_settings = {
  initialRouteName: 'index'
}

export default function WorkStackLayout() {
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
      <Stack.Screen name="item" options={{ headerShown: true, gestureEnabled: true }} />
    </Stack>
  )
}
