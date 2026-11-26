/** Rows for the Notifications page, in the grouped-card style of Settings (`ui/grouped-card.tsx`). */
import { Pressable, Switch, useWindowDimensions, View } from 'react-native'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'

/** A title, an optional line under it, and a switch. At the largest text sizes the title wraps instead of squeezing. */
export function SwitchRow({
  testID,
  title,
  detail,
  value,
  disabled,
  onChange
}: {
  testID: string
  title: string
  detail?: string
  value: boolean
  disabled?: boolean
  onChange: (next: boolean) => void
}) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingHorizontal: 14, paddingVertical: 12, gap: 12, opacity: disabled ? 0.45 : 1 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          {title}
        </AppText>
        {detail ? (
          <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <Switch
        testID={testID}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ false: theme.muted, true: theme.foreground }}
        thumbColor={theme.card}
        accessibilityLabel={title}
      />
    </View>
  )
}

/** A short explanation with one ink button under it (Turn on, Open iOS Settings). */
export function ActionRow({ testID, detail, label, busy, onPress }: { testID: string; detail: string; label: string; busy?: boolean; onPress: () => void }) {
  const theme = useTheme()
  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 14, gap: 12 }}>
      <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
        {detail}
      </AppText>
      <Pressable
        testID={testID}
        disabled={busy}
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => ({
          alignSelf: 'flex-start',
          minHeight: 44,
          justifyContent: 'center',
          paddingHorizontal: 18,
          borderRadius: 12,
          backgroundColor: theme.foreground,
          opacity: busy ? 0.5 : pressed ? 0.8 : 1
        })}
      >
        <AppText variant="name" color={theme.background} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={[MOBILE_SCALE.details.button, { fontFamily: 'Inter_600SemiBold' }]}>
          {label}
        </AppText>
      </Pressable>
    </View>
  )
}

/** A muted bot with an Unmute button; the button drops under the name at the largest text sizes. */
export function MutedBotRow({ name, onUnmute }: { name: string; onUnmute: () => void }) {
  const theme = useTheme()
  const stack = useWindowDimensions().fontScale >= 1.35
  return (
    <View
      style={{
        flexDirection: stack ? 'column' : 'row',
        alignItems: stack ? 'flex-start' : 'center',
        minHeight: 52,
        paddingHorizontal: 14,
        paddingVertical: 10,
        gap: stack ? 8 : 12
      }}
    >
      <AppText variant="name" numberOfLines={2} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: stack ? 0 : 1 }]}>
        {name}
      </AppText>
      <Pressable
        onPress={onUnmute}
        accessibilityRole="button"
        accessibilityLabel={`Unmute ${name}`}
        style={({ pressed }) => ({ minHeight: 36, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: theme.muted, opacity: pressed ? 0.7 : 1 })}
      >
        <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={[MOBILE_SCALE.details.button, { fontFamily: 'Inter_500Medium' }]}>
          Unmute
        </AppText>
      </Pressable>
    </View>
  )
}
