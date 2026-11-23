/** Root layout: GestureHandlerRootView, SafeAreaProvider, font & connection bootstrap,
 *  first-run Settings gate, and Expo Router Slot for the native tab shell once connected. */
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter'
import { useFonts } from 'expo-font'
import { Slot } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect } from 'react'
import { View } from 'react-native'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context'
import { useBotStore, watchRoster } from '../bots/store'
import { startConnection } from '../connection/start'
import { useConnectionStore } from '../connection/store'
import { SettingsScreen } from '../settings/screen'
import { useTheme } from '../ui/theme'

function AppGate() {
  const theme = useTheme()
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold })
  const settings = useConnectionStore(state => state.settings)
  const loaded = useConnectionStore(state => state.loaded)
  const connected = useConnectionStore(state => state.connected)
  const loadSettings = useConnectionStore(state => state.load)
  const loadBots = useBotStore(state => state.load)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  // `settings` (not just the address) is a dependency: a new token replaces the socket too.
  useEffect(() => {
    if (!loaded || !settings?.serverUrl) return
    startConnection()
    const stopWatching = watchRoster()
    return () => {
      stopWatching()
    }
  }, [loaded, settings])

  useEffect(() => {
    if (connected) void loadBots()
  }, [connected, loadBots])

  if (!fontsLoaded || !loaded) return <View style={{ flex: 1, backgroundColor: theme.background }} />
  if (!settings?.serverUrl) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <SettingsScreen />
      </SafeAreaView>
    )
  }
  return <Slot />
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <SafeAreaProvider>
        <AppGate />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}
