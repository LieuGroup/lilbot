/** Bar pinned directly above the software keyboard on forms: Done (or the form's own Cancel) on the left and the
 *  form's primary action on the right, so the action stays reachable while the field being typed in is in view. */
import { Keyboard, Pressable, View } from 'react-native'
import { DYNAMIC_TYPE_CAPS } from './dynamic-type'
import { AppText } from './text'
import { useTheme } from './theme'
import { MOBILE_SCALE, radius } from './tokens'

export interface KeyboardBarAction {
  label: string
  onPress: () => void
  disabled?: boolean
  testID?: string
}

export function KeyboardBar({ bottom, primary, secondary }: { bottom: number; primary?: KeyboardBarAction | null; secondary?: KeyboardBarAction }) {
  const theme = useTheme()
  if (bottom <= 0) return null
  const left = secondary ?? { label: 'Done', onPress: () => Keyboard.dismiss(), testID: 'keyboard-bar-done' }
  return (
    <View testID="keyboard-bar" style={{ position: 'absolute', left: 0, right: 0, bottom, height: 53, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderTopWidth: 1, borderTopColor: theme.hairline, backgroundColor: theme.card }}>
      <Pressable testID={left.testID} onPress={left.onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={secondary ? undefined : 'Dismiss keyboard'} style={({ pressed }) => ({ minHeight: 44, paddingHorizontal: 10, justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}>
        <AppText variant="name" color={theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
          {left.label}
        </AppText>
      </Pressable>
      {primary ? (
        <Pressable testID={primary.testID ?? 'keyboard-bar-action'} disabled={primary.disabled} onPress={primary.onPress} accessibilityRole="button" accessibilityState={{ disabled: Boolean(primary.disabled) }} style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 16, justifyContent: 'center', borderRadius: radius.md, backgroundColor: primary.disabled ? theme.muted : theme.foreground, opacity: pressed ? 0.75 : 1 })}>
          <AppText variant="name" numberOfLines={1} color={primary.disabled ? theme.mutedForeground : theme.background} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
            {primary.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  )
}
