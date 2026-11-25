/** Shared grouped-card primitives matching Round 3/4 iOS cards (`R3-05`, `R3-07a`, `R3-07b`):
 *  solid `theme.card` containers with hairline dividers, 44 pt hit targets, and ink-accent controls. */
import type { ReactNode } from 'react'
import { Pressable, View } from 'react-native'
import { AppText } from './text'
import { useTheme } from './theme'

export function SectionGroup({ title, trailing, footer, children }: { title: string; trailing?: string; footer?: string; children: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 }}>
        <AppText variant="meta" color={theme.mutedForeground}>
          {title}
        </AppText>
        {trailing ? (
          <AppText variant="meta" color={theme.mutedForeground}>
            {trailing}
          </AppText>
        ) : null}
      </View>
      <View style={{ borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>{children}</View>
      {footer ? (
        <AppText variant="meta" color={theme.mutedForeground} style={{ paddingHorizontal: 4, paddingTop: 2 }}>
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
      style={{ flexDirection: 'row', borderRadius: 9, backgroundColor: theme.muted, padding: 2, opacity: disabled ? 0.5 : 1 }}
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
              minHeight: 32,
              paddingHorizontal: 12,
              borderRadius: 7,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active ? theme.card : 'transparent'
            }}
          >
            <AppText
              variant="preview"
              numberOfLines={1}
              maxFontSizeMultiplier={1.25}
              color={active ? theme.foreground : theme.mutedForeground}
              style={{ fontFamily: active ? 'Inter_500Medium' : 'Inter_400Regular' }}
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
  const bg = tone === 'success' ? theme.muted : tone === 'destructive' ? theme.muted : theme.muted
  const fg = tone === 'success' ? theme.success : tone === 'destructive' ? theme.destructive : theme.mutedForeground
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: bg }}>
      <AppText variant="meta" color={fg} style={{ fontFamily: 'Inter_500Medium' }}>
        {label}
      </AppText>
    </View>
  )
}
