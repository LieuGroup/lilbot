/** The app's one screen: connects to the server, then shows the Duo shell. Without server
 *  settings it asks for them first. */
import { useFonts } from 'expo-font'
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter'
import { useEffect, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import { startConnection } from '../connection/start'
import { useConnectionStore } from '../connection/store'
import { useBotStore, watchRoster } from '../bots/store'
import { DuoShell } from '../duo/shell'
import { SettingsScreen } from '../settings/screen'
import { useTheme } from '../ui/theme'

export default function Home() {
  const theme = useTheme()
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold })
  const settings = useConnectionStore(state => state.settings)
  const loaded = useConnectionStore(state => state.loaded)
  const connected = useConnectionStore(state => state.connected)
  const loadSettings = useConnectionStore(state => state.load)
  const loadBots = useBotStore(state => state.load)
  const [showSettings, setShowSettings] = useState(false)

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

  if (!fontsLoaded || !loaded) return <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} />
  if (!settings?.serverUrl || showSettings) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <SettingsScreen onDone={() => setShowSettings(false)} />
      </SafeAreaView>
    )
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <DuoShell onOpenSettings={() => setShowSettings(true)} />
    </SafeAreaView>
  )
}
