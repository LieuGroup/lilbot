/** Isolates a throwing Settings section or pushed section page so one failing feature never blanks Settings. */
import { Component, type ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'

interface Props {
  sectionId: string
  children: ReactNode
}

interface State {
  failed: boolean
}

function SectionErrorFallback({ sectionId, onRetry }: { sectionId: string; onRetry: () => void }) {
  const theme = useTheme()
  return (
    <View testID={`settings-section-error-${sectionId}`} style={{ paddingHorizontal: 14, paddingVertical: 14, gap: 10 }}>
      <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
        This section could not load.
      </AppText>
      <Pressable
        onPress={onRetry}
        accessibilityRole="button"
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: 40,
          paddingHorizontal: 14,
          paddingVertical: 8,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.border,
          justifyContent: 'center',
          opacity: pressed ? 0.65 : 1
        })}
      >
        <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
          Try again
        </AppText>
      </Pressable>
    </View>
  )
}

export class SettingsSectionErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  override componentDidCatch() {
    // Error is contained to this section; never log sensitive settings state.
  }

  private readonly reset = () => {
    this.setState({ failed: false })
  }

  override render() {
    if (this.state.failed) return <SectionErrorFallback sectionId={this.props.sectionId} onRetry={this.reset} />
    return this.props.children
  }
}
