/** "Add a machine without a screen…" modal on Settings > Computers: picks OS/arch and computer name,
 *  mints a one-time code via `computers.commandLine.start`, and shows the verified copyable command. */
import { useEffect, useState } from 'react'
import { Keyboard, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CommandLineStart, CommandLineSystem } from '../../../shared/computer-add-schema'
import { buildOutsideCommand, buildPrivateCommand, installDetails, SYSTEM_OPTIONS } from '../../../shared/client/computers/command-line-script'
import { countdown } from '../../../shared/client/computers/computer-rows'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { copyText } from '../ui/copy'
import { CopyIcon } from '../ui/details-icons'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })

export function CommandLineSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardHeight = useKeyboardHeight(visible)
  const serverUrl = useConnectionStore(state => state.settings?.serverUrl ?? '')
  const [name, setName] = useState('')
  const [system, setSystem] = useState<CommandLineSystem>({ os: 'linux', arch: 'x64' })
  const [started, setStarted] = useState<CommandLineStart | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copiedKey, setCopiedKey] = useState<'cmd' | 'code' | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!visible) {
      setStarted(null)
      setError('')
      setCopiedKey(null)
      return
    }
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [visible])

  const start = async () => {
    const trimmed = name.trim()
    const socket = ensureSocket()
    if (!trimmed || !socket) return
    setBusy(true)
    setError('')
    try {
      setStarted(await socket.call('computers.commandLine.start', { name: trimmed, system }))
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (which: 'cmd' | 'code', value: string) => {
    const res = await copyText(value)
    if (res !== 'failed') {
      setCopiedKey(which)
      setTimeout(() => setCopiedKey(null), 1800)
    }
  }

  const origin = serverUrl.trim().replace(/\/+$/, '')
  const normalizedOrigin = /^https?:\/\//.test(origin) ? origin : origin ? `https://${origin}` : ''
  const command =
    started?.download && started.helperUrl
      ? (buildPrivateCommand({ privateOrigin: started.privateOrigin ?? normalizedOrigin, download: started.download, helperUrl: started.helperUrl }) ??
        buildOutsideCommand({ download: started.download, helperUrl: started.helperUrl }))
      : null
  const details = installDetails(system.os)

  return (
    <Modal visible={visible} presentationStyle="pageSheet" animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: Math.max(16, insets.top), paddingLeft: insets.left, paddingRight: insets.right }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title">Add a machine without a screen</AppText>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
            <CloseIcon color={theme.foreground} size={16} />
          </Pressable>
        </View>
        <ScrollView scrollIndicatorInsets={{ bottom: keyboardHeight }} contentContainerStyle={{ padding: 18, gap: 16, paddingBottom: sheetScrollBottomPadding(Math.max(28, insets.bottom + 12), keyboardHeight) }} {...KEYBOARD_SCROLL_PROPS}>
          {!started ? (
            <>
              <View style={{ gap: 6 }}>
                <AppText variant="meta" color={theme.mutedForeground}>
                  Computer name
                </AppText>
                <TextInput
                  testID="command-line-name"
                  value={name}
                  onChangeText={setName}
                  placeholder="Build server"
                  placeholderTextColor={theme.mutedForeground}
                  maxLength={100}
                  returnKeyType="done"
                  submitBehavior="blurAndSubmit"
                  onSubmitEditing={() => Keyboard.dismiss()}
                  style={{ backgroundColor: theme.card, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 10, fontFamily: 'Inter_400Regular', fontSize: 15, color: theme.foreground }}
                />
              </View>
              <View style={{ gap: 6 }}>
                <AppText variant="meta" color={theme.mutedForeground}>
                  System
                </AppText>
                <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>
                  {SYSTEM_OPTIONS.map((option, index) => {
                    const selected = option.os === system.os && option.arch === system.arch
                    return (
                      <Pressable
                        key={`${option.os}-${option.arch}`}
                        onPress={() => setSystem({ os: option.os, arch: option.arch })}
                        accessibilityRole="radio"
                        accessibilityState={{ selected }}
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44, paddingHorizontal: 14, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: theme.hairline }}
                      >
                        <AppText variant="name">{option.label}</AppText>
                        {selected ? <CheckIcon color={theme.foreground} size={16} /> : null}
                      </Pressable>
                    )
                  })}
                </View>
              </View>
              <AppText variant="meta" color={theme.mutedForeground}>
                {details.summary}
              </AppText>
              {error ? (
                <AppText variant="meta" color={theme.destructive}>
                  {error}
                </AppText>
              ) : null}
              <Pressable
                disabled={busy || !name.trim()}
                onPress={() => void start()}
                accessibilityRole="button"
                style={{ minHeight: 44, borderRadius: radius.md, backgroundColor: name.trim() ? theme.foreground : theme.muted, alignItems: 'center', justifyContent: 'center' }}
              >
                <AppText variant="name" color={name.trim() ? theme.background : theme.mutedForeground}>
                  {busy ? 'Creating code…' : 'Create install command'}
                </AppText>
              </Pressable>
            </>
          ) : (
            <>
              <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <AppText variant="meta" color={theme.mutedForeground}>
                    One-time code · expires in {countdown(started.expiresAt - now)}
                  </AppText>
                  <Pressable onPress={() => void copy('code', started.code)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy install code" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    {copiedKey === 'code' ? <CheckIcon color={theme.success} size={14} /> : <CopyIcon color={theme.mutedForeground} size={14} />}
                    <AppText variant="meta" color={theme.foreground}>
                      {copiedKey === 'code' ? 'Copied' : 'Copy'}
                    </AppText>
                  </Pressable>
                </View>
                <AppText style={{ fontFamily: MONO_FONT, fontSize: 18, lineHeight: 24, letterSpacing: 1 }} selectable>
                  {started.code}
                </AppText>
              </View>
              {command ? (
                <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 14, gap: 8 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <AppText variant="meta" color={theme.mutedForeground}>
                      Run on {name.trim()}
                    </AppText>
                    <Pressable onPress={() => void copy('cmd', command)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy install command" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {copiedKey === 'cmd' ? <CheckIcon color={theme.success} size={14} /> : <CopyIcon color={theme.mutedForeground} size={14} />}
                      <AppText variant="meta" color={theme.foreground}>
                        {copiedKey === 'cmd' ? 'Copied' : 'Copy'}
                      </AppText>
                    </Pressable>
                  </View>
                  <AppText style={{ fontFamily: MONO_FONT, fontSize: 12, lineHeight: 18 }} selectable>
                    {command}
                  </AppText>
                </View>
              ) : null}
              <AppText variant="meta" color={theme.mutedForeground}>
                {details.remove}
              </AppText>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}
