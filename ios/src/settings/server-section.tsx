/** Settings Server card (`R3-07a`): compact connected summary (`Server address >`, `Access token >`,
 *  `Disconnect`, expanding inline on tap) or first-launch connection form, using `MOBILE_SCALE.details`. */
import { useEffect, useRef, useState } from 'react'
import { Alert, Keyboard, Pressable, TextInput, useWindowDimensions, View } from 'react-native'
import { serverUrlError } from '../connection/lilbot'
import { stopConnection } from '../connection/start'
import { useConnectionStore } from '../connection/store'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../ui/dynamic-type'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { ChevronRightIcon } from '../ui/icon'
import type { KeyboardBarAction } from '../ui/keyboard-bar'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import type { FormFieldFocus } from '../ui/use-reveal-above-keyboard'

function serverHostLabel(raw: string): string {
  try {
    return new URL(raw).host || raw
  } catch {
    return raw
  }
}

export function ServerSettingsCard({ onDone, field: focus, onPrimaryAction }: { onDone?: () => void; field?: FormFieldFocus; onPrimaryAction?: (action: KeyboardBarAction | null) => void }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const stackWide = fontScale >= 1.35
  const rowLines = rosterRowTextLines(fontScale)
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
  const [disconnecting, setDisconnecting] = useState(false)
  const disconnectingRef = useRef(false)

  useEffect(() => {
    if (!editing) setServerUrl(settings?.serverUrl ?? '')
  }, [editing, settings?.serverUrl])

  useEffect(() => {
    if (!tokenEdited) setAccessToken(settings?.accessToken ?? '')
  }, [settings?.accessToken, tokenEdited])

  const submit = async () => {
    if (saving) return
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

  const runDisconnect = async () => {
    if (disconnectingRef.current) return
    disconnectingRef.current = true
    setDisconnecting(true)
    try {
      stopConnection()
      await disconnect()
    } finally {
      disconnectingRef.current = false
      setDisconnecting(false)
    }
  }

  const confirmDisconnect = () => {
    if (disconnectingRef.current) return
    Alert.alert('Disconnect from this server?', 'You will return to setup and need to enter the server address again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Disconnect', style: 'destructive', onPress: () => void runDisconnect() }
    ])
  }

  const hasServer = Boolean(settings?.serverUrl)
  const formShown = !hasServer || editing
  const canSubmit = !saving && Boolean(serverUrl.trim())
  const submitRef = useRef(submit)
  submitRef.current = submit
  useEffect(() => {
    onPrimaryAction?.(formShown ? { label: saving ? 'Saving…' : 'Save and connect', disabled: !canSubmit, testID: 'settings-save-bar', onPress: () => void submitRef.current() } : null)
  }, [canSubmit, formShown, onPrimaryAction, saving])

  const field = { backgroundColor: theme.background, borderRadius: radius.md, borderWidth: 1, borderColor: theme.input, paddingHorizontal: 12, paddingVertical: 11, fontFamily: 'Inter_400Regular', ...MOBILE_SCALE.details.input, color: theme.foreground } as const
  const summaryRow = { flexDirection: stackWide ? ('column' as const) : ('row' as const), alignItems: stackWide ? ('flex-start' as const) : ('center' as const), justifyContent: 'space-between' as const, minHeight: 52, paddingHorizontal: 14, paddingVertical: 12, gap: stackWide ? 4 : 12 }

  return (
    <SectionGroup title="Server">
      {hasServer && !editing ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12 }}>
            <View style={{ width: 9, height: 9, borderRadius: 4.5, backgroundColor: connected ? theme.success : theme.mutedForeground, opacity: connected ? 1 : 0.4 }} />
            <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { flex: 1 }]}>
              {connected ? 'Connected' : 'Not connected'}
              {device ? ` · ${device.name}` : ''}
            </AppText>
          </View>
          <RowDivider />
          <Pressable testID="settings-edit-server" onPress={() => setEditing(true)} accessibilityRole="button" style={({ pressed }) => ({ ...summaryRow, opacity: pressed ? 0.65 : 1 })}>
            <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
              Server address
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
              <AppText variant="preview" color={theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {serverHostLabel(settings?.serverUrl ?? '')}
              </AppText>
              <ChevronRightIcon color={theme.mutedForeground} size={15} />
            </View>
          </Pressable>
          <RowDivider />
          <Pressable onPress={() => setEditing(true)} accessibilityRole="button" style={({ pressed }) => ({ ...summaryRow, opacity: pressed ? 0.65 : 1 })}>
            <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
              Access token
            </AppText>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {settings?.accessToken ? 'Saved' : 'None'}
              </AppText>
              <ChevronRightIcon color={theme.mutedForeground} size={15} />
            </View>
          </Pressable>
          <RowDivider />
          <Pressable disabled={disconnecting} onPress={confirmDisconnect} accessibilityRole="button" accessibilityState={{ disabled: disconnecting }} style={({ pressed }) => ({ minHeight: 50, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 10, opacity: disconnecting ? 0.45 : pressed ? 0.65 : 1 })}>
            <AppText variant="name" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
              {disconnecting ? 'Disconnecting…' : 'Disconnect'}
            </AppText>
          </Pressable>
        </>
      ) : (
        <View style={{ padding: 14, gap: 14 }}>
          <View style={{ gap: 6 }}>
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader} style={MOBILE_SCALE.details.sectionHeader}>
              Server address
            </AppText>
            <TextInput testID="server-url-input" onFocus={focus?.onFocus} onBlur={focus?.onBlur} value={serverUrl} onChangeText={setServerUrl} placeholder="https://lilbot.example.com" placeholderTextColor={theme.mutedForeground} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => Keyboard.dismiss()} textContentType="none" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput} style={field} />
          </View>
          <View style={{ gap: 6 }}>
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader} style={MOBILE_SCALE.details.sectionHeader}>
              Access token (optional)
            </AppText>
            <TextInput testID="access-token-input" onFocus={focus?.onFocus} onBlur={focus?.onBlur} value={accessToken} onChangeText={value => { setTokenEdited(true); setAccessToken(value) }} placeholder="Optional on a private network" placeholderTextColor={theme.mutedForeground} autoCapitalize="none" autoCorrect={false} secureTextEntry returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => Keyboard.dismiss()} textContentType="none" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput} style={field} />
            <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              Sign-in through the public address is not supported from the iPhone app yet.
            </AppText>
          </View>
          <Pressable testID="settings-save-button" onPress={() => void submit()} disabled={saving || !serverUrl.trim()} style={{ backgroundColor: serverUrl.trim() ? theme.foreground : theme.muted, borderRadius: radius.md, minHeight: 48, paddingVertical: 10, justifyContent: 'center', alignItems: 'center' }}>
            <AppText variant="name" color={serverUrl.trim() ? theme.background : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
              {saving ? 'Saving…' : 'Save and connect'}
            </AppText>
          </Pressable>
          {hasServer ? (
            <Pressable onPress={() => { setEditing(false); setError('') }} style={{ minHeight: 40, justifyContent: 'center', alignItems: 'center' }}>
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                Cancel
              </AppText>
            </Pressable>
          ) : null}
          {error || tokenNotice ? (
            <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
              {error || tokenNotice}
            </AppText>
          ) : null}
        </View>
      )}
    </SectionGroup>
  )
}
