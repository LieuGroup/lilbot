/** "Add a machine without a screen…" modal on Settings > Computers: picks OS/arch and computer name,
 *  mints a one-time code via `computers.commandLine.start`, and shows the copyable command on `MOBILE_SCALE.details`. */
import { useEffect, useState } from 'react'
import { Keyboard, Modal, Platform, Pressable, ScrollView, TextInput, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { CommandLineStart, CommandLineSystem } from '../../../shared/computer-add-schema'
import { buildOutsideCommand, buildPrivateCommand, installDetails, SYSTEM_OPTIONS } from '../../../shared/client/computers/command-line-script'
import { countdown } from '../../../shared/client/computers/computer-rows'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { copyText } from '../ui/copy'
import { CopyIcon } from '../ui/details-icons'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../ui/dynamic-type'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'

const MONO_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' })

export function CommandLineSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { fontScale } = useWindowDimensions()
  const rowLines = rosterRowTextLines(fontScale)
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
    if (!trimmed || !socket || busy) return
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
    if (res === 'copied') {
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
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingBottom: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
          <AppText variant="title" numberOfLines={2} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={[MOBILE_SCALE.details.sheetTitle, { flex: 1 }]}>
            Add a machine without a screen
          </AppText>
          <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.muted }}>
            <CloseIcon color={theme.foreground} size={16} />
          </Pressable>
        </View>
        <ScrollView scrollIndicatorInsets={{ bottom: keyboardHeight }} contentContainerStyle={{ padding: 18, gap: 16, paddingBottom: sheetScrollBottomPadding(Math.max(28, insets.bottom + 12), keyboardHeight) }} {...KEYBOARD_SCROLL_PROPS}>
          {!started ? (
            <>
              <View style={{ gap: 6 }}>
                <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader} style={MOBILE_SCALE.details.sectionHeader}>
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
                  maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.composerInput}
                  style={{ backgroundColor: theme.card, borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, paddingHorizontal: 12, paddingVertical: 11, fontFamily: 'Inter_400Regular', fontSize: MOBILE_SCALE.details.input.fontSize, lineHeight: MOBILE_SCALE.details.input.lineHeight, color: theme.foreground }}
                />
              </View>
              <View style={{ gap: 6 }}>
                <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader} style={MOBILE_SCALE.details.sectionHeader}>
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
                        style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: index > 0 ? 1 : 0, borderTopColor: theme.hairline }}
                      >
                        <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
                          {option.label}
                        </AppText>
                        {selected ? <CheckIcon color={theme.foreground} size={16} /> : null}
                      </Pressable>
                    )
                  })}
                </View>
              </View>
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>{details.summary}</AppText>
              {error ? <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>{error}</AppText> : null}
              <Pressable disabled={busy || !name.trim()} onPress={() => void start()} accessibilityRole="button" style={{ minHeight: 48, paddingVertical: 10, borderRadius: radius.md, backgroundColor: name.trim() ? theme.foreground : theme.muted, alignItems: 'center', justifyContent: 'center' }}>
                <AppText variant="name" color={name.trim() ? theme.background : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>{busy ? 'Creating code…' : 'Create install command'}</AppText>
              </Pressable>
            </>
          ) : (
            <>
              <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, padding: 14, gap: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { flex: 1 }]}>
                    One-time code · expires in {countdown(started.expiresAt - now)}
                  </AppText>
                  <Pressable onPress={() => void copy('code', started.code)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy install code" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36 }}>
                    {copiedKey === 'code' ? <CheckIcon color={theme.success} size={15} /> : <CopyIcon color={theme.mutedForeground} size={15} />}
                    <AppText variant="name" color={theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.tabLabel}>
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
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { flex: 1 }]}>
                      Run on {name.trim()}
                    </AppText>
                    <Pressable onPress={() => void copy('cmd', command)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy install command" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36 }}>
                      {copiedKey === 'cmd' ? <CheckIcon color={theme.success} size={15} /> : <CopyIcon color={theme.mutedForeground} size={15} />}
                      <AppText variant="name" color={theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.tabLabel}>
                        {copiedKey === 'cmd' ? 'Copied' : 'Copy'}
                      </AppText>
                    </Pressable>
                  </View>
                  <AppText style={[MOBILE_SCALE.details.code, { fontFamily: MONO_FONT }]} selectable>
                    {command}
                  </AppText>
                </View>
              ) : null}
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
                {details.remove}
              </AppText>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}
