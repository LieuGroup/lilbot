/** Settings (`R3-07a`): Server connection card plus registered sections from `sections/index.ts`.
 *  Each registered section renders inside `SettingsSectionErrorBoundary` so one throwing section never blanks Settings. */
import { Fragment } from 'react'
import { Pressable, ScrollView } from 'react-native'
import { useConnectionStore } from '../connection/store'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { useKeyboardHeight } from '../ui/use-keyboard-height'
import { SettingsSectionErrorBoundary } from './section-error-boundary'
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
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    >
      {!hasServer ? (
        <AppText variant="title" style={MOBILE_SCALE.details.botTitle}>
          Settings
        </AppText>
      ) : null}

      <ServerSettingsCard onDone={onDone} />

      {navSections.length > 0 ? (
        <SectionGroup title="LilBot">
          {navSections.map((section, index) => (
            <Fragment key={section.id}>
              {index > 0 ? <RowDivider /> : null}
              <SettingsSectionErrorBoundary sectionId={section.id}>
                <section.Component navigate={navigate} connected={connected} />
              </SettingsSectionErrorBoundary>
            </Fragment>
          ))}
        </SectionGroup>
      ) : null}

      {inlineSections.map(section => (
        <SettingsSectionErrorBoundary key={section.id} sectionId={section.id}>
          <section.Component navigate={navigate} connected={connected} />
        </SettingsSectionErrorBoundary>
      ))}

      {hasServer && onDone ? (
        <Pressable onPress={onDone} style={{ minHeight: 44, justifyContent: 'center', paddingVertical: 8 }}>
          <AppText variant="name" color={theme.foreground} style={MOBILE_SCALE.details.button}>
            Back
          </AppText>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}
