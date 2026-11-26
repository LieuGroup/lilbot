/** Shared grouped-card primitives matching Round 3/4 iOS cards (`R3-05`, `R3-07a`, `R3-07b`):
 *  solid `theme.card` containers with hairline dividers, 44 pt hit targets, and `MOBILE_SCALE.details` sizing. */
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { DYNAMIC_TYPE_CAPS } from './dynamic-type'
import { AppText } from './text'
import { useTheme } from './theme'
import { MOBILE_SCALE } from './tokens'

export function SectionGroup({ title, trailing, footer, children }: { title: string; trailing?: string; footer?: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 6 }}>
      {title || trailing ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, gap: 8 }}>
          <AppText
            variant="name"
            color={theme.mutedForeground}
            maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader}
            style={[MOBILE_SCALE.details.sectionHeader, { flexShrink: 1 }]}
          >
            {title}
          </AppText>
          {trailing ? (
            <AppText
              variant="meta"
              color={theme.mutedForeground}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader}
              style={MOBILE_SCALE.details.sectionHeader}
            >
              {trailing}
            </AppText>
          ) : null}
        </View>
      ) : null}
      <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>{children}</View>
      {footer ? (
        <AppText
          variant="preview"
          color={theme.mutedForeground}
          maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview}
          style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4, paddingTop: 2 }]}
        >
          {footer}
        </AppText>
      ) : null}
    </View>
  )
}

export function RowDivider() {
  const theme = useTheme()
  return <View style={{ height: 1, backgroundColor: theme.hairline }} />
}

export function SegmentedChoice<T extends string>({
  value,
  options,
  disabled,
  accessibilityLabel,
  onChange
}: {
  value: T
  options: readonly { value: T; label: string }[]
  disabled?: boolean
  accessibilityLabel: string
  onChange: (next: T) => void
}) {
  const theme = useTheme()
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      style={{ flexDirection: 'row', borderRadius: 10, backgroundColor: theme.muted, padding: 3, opacity: disabled ? 0.5 : 1 }}
    >
      {options.map(option => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            disabled={disabled}
            onPress={() => {
              if (!active) onChange(option.value)
            }}
            accessibilityRole="radio"
            accessibilityState={{ selected: active, disabled: Boolean(disabled) }}
            style={{
              minHeight: 36,
              paddingHorizontal: 14,
              paddingVertical: 6,
              borderRadius: 7,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? theme.card : 'transparent'
            }}
          >
            <AppText
              variant="name"
              numberOfLines={1}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.tabLabel}
              color={active ? theme.foreground : theme.mutedForeground}
              style={[MOBILE_SCALE.details.tabLabel, { fontFamily: active ? 'Inter_500Medium' : 'Inter_400Regular' }]}
            >
              {option.label}
            </AppText>
          </Pressable>
        )
      })}
    </View>
  )
}

export function PillBadge({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'success' | 'destructive' }) {
  const theme = useTheme()
  const fg = tone === 'success' ? theme.success : tone === 'destructive' ? theme.destructive : theme.mutedForeground
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: theme.muted }}>
      <AppText
        variant="meta"
        color={fg}
        maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control}
        style={[MOBILE_SCALE.details.meta, { fontFamily: 'Inter_500Medium' }]}
      >
        {label}
      </AppText>
    </View>
  )
}
