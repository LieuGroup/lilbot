/** Settings (`R3-07a`): Server connection card plus registered sections from `sections/index.ts`.
 *  Feature sections (Computers, future Notifications/Memory, General Delete defaults) live in
 *  `settings/sections/` so sibling threads register without editing this file. */
import { Fragment } from 'react'
import { Pressable, ScrollView } from 'react-native'
import { useConnectionStore } from '../connection/store'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { type SettingsSectionDefinition, visibleSettingsSections } from './sections'
import { SETTINGS_SECTIONS } from './sections/index'
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
  const settings = useConnectionStore(state => state.settings)
  const connected = useConnectionStore(state => state.connected)
  const hasServer = Boolean(settings?.serverUrl)
  const navSections = visibleSettingsSections(sections, { hasServer, group: 'navigation' })
  const inlineSections = visibleSettingsSections(sections, { hasServer, group: 'inline' })
  const navigate = (routeName: string) => onNavigateSection?.(routeName)

  return (
    <ScrollView
      testID="settings-screen"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      scrollIndicatorInsets={{ bottom: keyboardHeight }}
      contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: sheetScrollBottomPadding(hasServer ? 116 : 40, keyboardHeight) }}
      {...KEYBOARD_SCROLL_PROPS}
    >
      {!hasServer ? <AppText variant="title">Settings</AppText> : null}

      <ServerSettingsCard onDone={onDone} />

      {navSections.length > 0 ? (
        <SectionGroup title="LilBot">
          {navSections.map((section, index) => (
            <Fragment key={section.id}>
              {index > 0 ? <RowDivider /> : null}
              <section.Component navigate={navigate} connected={connected} />
            </Fragment>
          ))}
        </SectionGroup>
      ) : null}

      {inlineSections.map(section => (
        <section.Component key={section.id} navigate={navigate} connected={connected} />
      ))}

      {hasServer && onDone ? (
        <Pressable onPress={onDone} style={{ paddingVertical: 8 }}>
          <AppText variant="name" color={theme.foreground}>
            Back
          </AppText>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}
