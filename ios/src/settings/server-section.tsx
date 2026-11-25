/** Settings Server card (`R3-07a`): compact connected summary (`Server address >`, `Access token >`,
 *  `Disconnect`, expanding inline on tap) or first-launch connection form. */
import { useEffect, useState } from 'react'
import { Alert, Keyboard, Pressable, TextInput, useWindowDimensions, View } from 'react-native'
import { serverUrlError } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'

function serverHostLabel(raw: string): string {
  try {
    return new URL(raw).host || raw
  } catch {
    return raw
  }
}

export function ServerSettingsCard({ onDone }: { onDone?: () => void }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stackWide = fontScale >= 1.35
  const settings = useConnectionStore(state => state.settings)
  const connected = useConnectionStore(state => state.connected)
  const device = useConnectionStore(state => state.device)
  const tokenNotice = useConnectionStore(state => state.tokenNotice)
  const save = useConnectionStore(state => state.save)
  const disconnect = useConnectionStore(state => state.disconnect)
  const [serverUrl, setServerUrl] = useState(settings?.serverUrl ?? '')
  const [accessToken, setAccessToken] = useState(settings?.accessToken ?? '')
  const [tokenEdited, setTokenEdited] = useState(false)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!editing) setServerUrl(settings?.serverUrl ?? '')
  }, [editing, settings?.serverUrl])

  useEffect(() => {
    if (!tokenEdited) setAccessToken(settings?.accessToken ?? '')
  }, [settings?.accessToken, tokenEdited])

  const submit = async () => {
    const invalid = serverUrlError(serverUrl)
    if (invalid) {
      setError(invalid)
      return
    }
    setSaving(true)
    setError('')
    try {
      await save({ serverUrl: serverUrl.trim(), accessToken: accessToken.trim() }, { clearToken: tokenEdited })
      setTokenEdited(false)
      setEditing(false)
      onDone?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the settings.')
    } finally {
      setSaving(false)
    }
  }

  const confirmDisconnect = () => {
    Alert.alert('Disconnect from this server?', 'You will return to setup and need to enter the server address again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void disconnect() }
    ])
  }

  const hasServer = Boolean(settings?.serverUrl)
  const field = {
    backgroundColor: theme.background,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: theme.input,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: theme.foreground
  } as const

  const summaryRow = {
    flexDirection: stackWide ? ('column' as const) : ('row' as const),
    alignItems: stackWide ? ('flex-start' as const) : ('center' as const),
    justifyContent: 'space-between' as const,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: stackWide ? 4 : 12
  }

  return (
    <SectionGroup title="Server">
      {hasServer && !editing ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: connected ? theme.success : theme.mutedForeground, opacity: connected ? 1 : 0.4 }} />
            <AppText variant="meta" color={theme.mutedForeground} style={{ flex: 1 }}>
              {connected ? 'Connected' : 'Not connected'}
              {device ? ` · ${device.name}` : ''}
            </AppText>
          </View>
          <RowDivider />
          <Pressable testID="settings-edit-server" onPress={() => setEditing(true)} accessibilityRole="button" style={({ pressed }) => ({ ...summaryRow, opacity: pressed ? 0.65 : 1 })}>
            <AppText variant="name">Server address</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
              <AppText variant="preview" color={theme.mutedForeground} numberOfLines={1}>
                {serverHostLabel(settings?.serverUrl ?? '')}
              </AppText>
              <ChevronRightIcon color={theme.mutedForeground} size={14} />
            </View>
          </Pressable>
          <RowDivider />
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" style={({ pressed }) => ({ ...summaryRow, opacity: pressed ? 0.65 : 1 })}>
            <AppText variant="name">Access token</AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppText variant="preview" color={theme.mutedForeground}>
                {settings?.accessToken ? 'Saved' : 'None'}
              </AppText>
              <ChevronRightIcon color={theme.mutedForeground} size={14} />
            </View>
          </Pressable>
          <RowDivider />
          <Pressable onPress={confirmDisconnect} accessibilityRole="button" style={({ pressed }) => ({ minHeight: 46, justifyContent: 'center', paddingHorizontal: 14, opacity: pressed ? 0.65 : 1 })}>
            <AppText variant="name" color={theme.destructive}>
              Disconnect
            </AppText>
          </Pressable>
        </>
      ) : (
        <View style={{ padding: 14, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <AppText variant="meta" color={theme.mutedForeground}>
              Server address
            </AppText>
            <TextInput testID="server-url-input" value={serverUrl} onChangeText={setServerUrl} placeholder="https://lilbot.example.com" placeholderTextColor={theme.mutedForeground} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => Keyboard.dismiss()} textContentType="none" style={field} />
          </View>
          <View style={{ gap: 6 }}>
            <AppText variant="meta" color={theme.mutedForeground}>
              Access token (optional)
            </AppText>
            <TextInput
              testID="access-token-input"
              value={accessToken}
              onChangeText={value => {
                setTokenEdited(true)
                setAccessToken(value)
              }}
              placeholder="Optional on a private network"
              placeholderTextColor={theme.mutedForeground}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              returnKeyType="done"
              submitBehavior="blurAndSubmit"
              onSubmitEditing={() => Keyboard.dismiss()}
              textContentType="none"
              style={field}
            />
            <AppText variant="meta" color={theme.mutedForeground}>
              Sign-in through the public address is not supported from the iPhone app yet.
            </AppText>
          </View>
          <Pressable testID="settings-save-button" onPress={() => void submit()} disabled={saving || !serverUrl.trim()} style={{ backgroundColor: serverUrl.trim() ? theme.foreground : theme.muted, borderRadius: radius.md, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
            <AppText variant="name" color={serverUrl.trim() ? theme.background : theme.mutedForeground}>
              {saving ? 'Saving…' : 'Save and connect'}
            </AppText>
          </Pressable>
          {hasServer ? (
            <Pressable onPress={() => { setEditing(false); setError('') }} style={{ minHeight: 36, justifyContent: 'center', alignItems: 'center' }}>
              <AppText variant="preview" color={theme.mutedForeground}>
                Cancel
              </AppText>
            </Pressable>
          ) : null}
          {error || tokenNotice ? (
            <AppText variant="meta" color={theme.destructive}>
              {error || tokenNotice}
            </AppText>
          ) : null}
        </View>
      )}
    </SectionGroup>
  )
}
