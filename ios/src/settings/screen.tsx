/** Settings: the server address and Access token this install talks to, plus connection state.
 *  The token is Oscar's Cloudflare Access JWT; the app sends it on every request. */
import { useState } from 'react'
import { Pressable, ScrollView, TextInput, View } from 'react-native'
import { useConnectionStore } from '../connection/store'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'
import { radius } from '../ui/tokens'

export function SettingsScreen({ onDone }: { onDone: () => void }) {
  const theme = useTheme()
  const settings = useConnectionStore(state => state.settings)
  const connected = useConnectionStore(state => state.connected)
  const device = useConnectionStore(state => state.device)
  const save = useConnectionStore(state => state.save)
  const [serverUrl, setServerUrl] = useState(settings?.serverUrl ?? '')
  const [accessToken, setAccessToken] = useState(settings?.accessToken ?? '')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    setSaving(true)
    try {
      await save({ serverUrl: serverUrl.trim(), accessToken: accessToken.trim() })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const field = {
    backgroundColor: theme.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: theme.foreground
  } as const

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.background }} contentContainerStyle={{ padding: 20, gap: 16 }}>
      <AppText variant="title">Settings</AppText>

      <View style={{ gap: 6 }}>
        <AppText variant="meta" color={theme.mutedForeground}>
          Server address
        </AppText>
        <TextInput value={serverUrl} onChangeText={setServerUrl} placeholder="https://lilbot.example.com" placeholderTextColor={theme.mutedForeground} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={field} />
      </View>

      <View style={{ gap: 6 }}>
        <AppText variant="meta" color={theme.mutedForeground}>
          Cloudflare Access token
        </AppText>
        <TextInput value={accessToken} onChangeText={setAccessToken} placeholder="cf-access-jwt-assertion value" placeholderTextColor={theme.mutedForeground} autoCapitalize="none" autoCorrect={false} secureTextEntry style={field} />
        <AppText variant="meta" color={theme.mutedForeground}>
          From your browser's cookies for the LilBot domain (CF_Authorization), or a service token.
        </AppText>
      </View>

      <Pressable onPress={() => void submit()} disabled={saving || !serverUrl.trim()} style={{ backgroundColor: serverUrl.trim() ? theme.primary : theme.muted, borderRadius: radius.md, paddingVertical: 12, alignItems: 'center' }}>
        <AppText variant="name" color={serverUrl.trim() ? theme.primaryForeground : theme.mutedForeground}>
          {saving ? 'Saving…' : 'Save and connect'}
        </AppText>
      </Pressable>

      <View style={{ gap: 6, marginTop: 12 }}>
        <AppText variant="meta" color={theme.mutedForeground}>
          {connected ? 'Connected' : 'Not connected'}
          {device ? ` · this device: ${device.name}` : ''}
        </AppText>
      </View>

      {settings && (
        <Pressable onPress={onDone} style={{ marginTop: 8 }}>
          <AppText variant="name" color={theme.primary}>
            Back
          </AppText>
        </Pressable>
      )}
    </ScrollView>
  )
}
