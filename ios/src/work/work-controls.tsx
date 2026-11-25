/** Small shared button and text-input primitives for Work board cards and item actions. */
import type { ReactNode } from 'react'
import { Pressable, TextInput, type TextInputProps, View } from 'react-native'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
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
        minHeight: 40,
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
        variant="name"
        maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton}
        color={textColor}
        style={{ fontFamily: tone === 'primary' || tone === 'destructive' ? 'Inter_600SemiBold' : 'Inter_500Medium' }}
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
      {...props}
      style={[
        {
          minHeight: 40,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: theme.input,
          backgroundColor: theme.background,
          paddingHorizontal: 12,
          paddingVertical: 8,
          fontFamily: 'Inter_400Regular',
          fontSize: 15,
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
    <View style={{ gap: 2 }}>
      <AppText variant="meta" color={theme.mutedForeground} style={{ paddingHorizontal: 10, paddingBottom: 4 }}>
        {title}
      </AppText>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, paddingVertical: 4 }}>{children}</View>
    </View>
  )
}
