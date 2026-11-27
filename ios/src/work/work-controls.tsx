/** Shared button, input, section card, notice box, and keyboard-dismiss bar primitives for Work screens (MOBILE_SCALE.work). */
import type { ReactNode } from 'react'
import { Keyboard, Pressable, TextInput, type TextInputProps, View } from 'react-native'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { WORK_TYPE_CAPS } from './board-state'

type Tone = 'primary' | 'secondary' | 'destructive' | 'ghost'

export function WorkButton({
  testID,
  label,
  tone = 'primary',
  disabled = false,
  accessibilityLabel,
  onPress
}: {
  testID?: string
  label: string
  tone?: Tone
  disabled?: boolean
  accessibilityLabel?: string
  onPress: () => void
}) {
  const theme = useTheme()
  const backgroundColor =
    tone === 'primary' ? theme.foreground : tone === 'destructive' ? theme.destructive : tone === 'secondary' ? theme.background : 'transparent'
  const textColor = tone === 'primary' ? theme.background : tone === 'destructive' ? '#FFFFFF' : theme.foreground

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        minHeight: 44,
        paddingHorizontal: tone === 'ghost' ? 14 : 16,
        borderRadius: radius.md,
        borderWidth: tone === 'secondary' ? 1 : 0,
        borderColor: theme.hairline,
        backgroundColor,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? 0.45 : pressed ? 0.78 : 1
      })}
    >
      <AppText
        maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton}
        color={textColor}
        style={[MOBILE_SCALE.work.button, { fontFamily: tone === 'primary' || tone === 'destructive' ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}
      >
        {label}
      </AppText>
    </Pressable>
  )
}

export function WorkInput({ style, ...props }: TextInputProps) {
  const theme = useTheme()
  return (
    <TextInput
      placeholderTextColor={theme.mutedForeground}
      maxFontSizeMultiplier={WORK_TYPE_CAPS.input}
      {...props}
      style={[
        {
          minHeight: 44,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.input,
          backgroundColor: theme.background,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontFamily: 'Inter_400Regular',
          fontSize: MOBILE_SCALE.work.input.fontSize,
          lineHeight: MOBILE_SCALE.work.input.lineHeight,
          color: theme.foreground
        },
        style
      ]}
    />
  )
}

export function WorkSectionCard({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 4 }}>
      <AppText
        color={theme.mutedForeground}
        maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader}
        style={[MOBILE_SCALE.work.sectionHeader, { paddingHorizontal: 10, paddingBottom: 2, fontFamily: 'Inter_500Medium' }]}
      >
        {title}
      </AppText>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, paddingVertical: 4 }}>{children}</View>
    </View>
  )
}

export function WorkNoticeBox({ testID, message, onDismiss }: { testID?: string; message: string; onDismiss?: () => void }) {
  const theme = useTheme()
  return (
    <View
      testID={testID}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 10,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: theme.hairline,
        backgroundColor: theme.background,
        paddingHorizontal: 12,
        paddingVertical: 8
      }}
    >
      <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={[MOBILE_SCALE.work.rowMeta, { flex: 1 }]}>
        {message}
      </AppText>
      {onDismiss ? (
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityRole="button" accessibilityLabel="Dismiss notice" style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 6 }}>
          <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} style={[MOBILE_SCALE.work.chip, { fontFamily: 'Inter_600SemiBold' }]}>
            Dismiss
          </AppText>
        </Pressable>
      ) : null}
    </View>
  )
}

/** Slim keyboard-dismiss bar pinned directly above the software keyboard on scrollable Work screens. */
export function WorkKeyboardDoneBar({ keyboardHeight, testID = 'work-keyboard-done' }: { keyboardHeight: number; testID?: string }) {
  const theme = useTheme()
  if (keyboardHeight <= 0) return null
  return (
    <View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: keyboardHeight,
        flexDirection: 'row',
        justifyContent: 'flex-end',
        paddingHorizontal: 14,
        paddingVertical: 4,
        borderTopWidth: 1,
        borderTopColor: theme.hairline,
        backgroundColor: theme.card
      }}
    >
      <Pressable
        testID={testID}
        onPress={() => Keyboard.dismiss()}
        accessibilityRole="button"
        accessibilityLabel="Dismiss keyboard"
        style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}
      >
        <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} style={[MOBILE_SCALE.work.button, { fontFamily: 'Inter_600SemiBold' }]}>
          Done
        </AppText>
      </Pressable>
    </View>
  )
}
