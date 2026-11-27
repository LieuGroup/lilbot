/** Settings (`R3-07a`): Server connection card plus registered sections from `sections/index.ts`.
 *  Each registered section renders inside `SettingsSectionErrorBoundary` (`section-list.tsx`) so one throwing section never blanks Settings. */
import { useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useConnectionStore } from '../connection/store'
import { KeyboardBar, type KeyboardBarAction } from '../ui/keyboard-bar'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { useKeyboardHeight } from '../ui/use-keyboard-height'
import { useRevealAboveKeyboard } from '../ui/use-reveal-above-keyboard'
import { type SettingsSectionDefinition, visibleSettingsSections } from './sections'
import { SETTINGS_SECTIONS } from './sections/index'
import { SettingsSectionList } from './section-list'
import { ServerSettingsCard } from './server-section'

export function SettingsScreen({
  onDone,
  onNavigateSection,
  sections = SETTINGS_SECTIONS
}: {
  onDone?: () => void
  onNavigateSection?: (routeName: string) => void
  sections?: readonly SettingsSectionDefinition[]
}) {
  const theme = useTheme()
  const keyboardHeight = useKeyboardHeight()
  const form = useRevealAboveKeyboard(keyboardHeight)
  const [saveAction, setSaveAction] = useState<KeyboardBarAction | null>(null)
  const settings = useConnectionStore(state => state.settings)
  const connected = useConnectionStore(state => state.connected)
  const hasServer = Boolean(settings?.serverUrl)
  const navSections = visibleSettingsSections(sections, { hasServer, group: 'navigation' })
  const inlineSections = visibleSettingsSections(sections, { hasServer, group: 'inline' })
  const navigate = (routeName: string) => onNavigateSection?.(routeName)

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={form.scrollRef}
        testID="settings-screen"
        onScroll={form.onScroll}
        onLayout={form.onLayout}
        onContentSizeChange={form.onContentSizeChange}
        scrollEventThrottle={32}
        style={{ flex: 1, backgroundColor: theme.background }}
        contentInsetAdjustmentBehavior="automatic"
        scrollIndicatorInsets={{ bottom: form.doneBarHeight }}
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: sheetScrollBottomPadding(hasServer ? 116 : 40, form.contentBottom) }}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
      >
        {!hasServer ? (
          <AppText variant="title" style={MOBILE_SCALE.details.botTitle}>
            Settings
          </AppText>
        ) : null}

        <ServerSettingsCard onDone={onDone} field={{ onFocus: form.onFieldFocus, onBlur: form.onFieldBlur }} onPrimaryAction={setSaveAction} />

        <SettingsSectionList navSections={navSections} inlineSections={inlineSections} navigate={navigate} connected={connected} />

      {hasServer && onDone ? (
          <Pressable onPress={onDone} style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8 }}>
            <AppText variant="name" color={theme.foreground} style={MOBILE_SCALE.details.button}>
              Back
            </AppText>
          </Pressable>
        ) : null}
      </ScrollView>
      <KeyboardBar bottom={form.doneBarHeight} primary={saveAction} />
    </View>
  )
}
