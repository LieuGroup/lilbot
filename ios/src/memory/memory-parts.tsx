/** Shared pieces of the Memory pages: the scrolling page (with the inline title the Duo uses in place of a header row),
 *  a titled grouped card, the muted hint line, and a quiet status line for loading, errors and empty lists. */
import { type ComponentRef, Fragment, type ReactNode, type RefObject } from 'react'
import { ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'

export function MemoryScroll({ testID, title, scrollRef, children }: { testID: string; title?: string; scrollRef?: RefObject<ComponentRef<typeof ScrollView> | null>; children: ReactNode }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const keyboard = useKeyboardHeight()
  return (
    <ScrollView
      ref={scrollRef}
      testID={testID}
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      scrollIndicatorInsets={{ bottom: keyboard }}
      contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: Math.max(32, insets.bottom + 16, keyboard + 16) }}
      {...KEYBOARD_SCROLL_PROPS}
    >
      {title ? (
        <AppText variant="title" accessibilityRole="header" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.botTitle}>
          {title}
        </AppText>
      ) : null}
      {children}
    </ScrollView>
  )
}

/** A grouped card under a muted title and count, with hairlines between its rows. */
export function MemoryGroup({ title, count, children }: { title: string; count?: number; children: ReactNode[] }) {
  return (
    <SectionGroup title={title} trailing={count === undefined ? undefined : String(count)}>
      {children.filter(Boolean).map((child, index) => (
        <Fragment key={index}>
          {index > 0 ? <RowDivider /> : null}
          {child}
        </Fragment>
      ))}
    </SectionGroup>
  )
}

export function MemoryNote({ children, tone = 'muted' }: { children: string; tone?: 'muted' | 'error' }) {
  const theme = useTheme()
  return (
    <AppText
      variant="preview"
      color={tone === 'error' ? theme.destructive : theme.mutedForeground}
      maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview}
      style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}
    >
      {children}
    </AppText>
  )
}

/** Loading, or why the list could not load. */
export function MemoryStatus({ error }: { error: string }) {
  return (
    <View style={{ paddingTop: 8 }}>
      <MemoryNote tone={error ? 'error' : 'muted'}>{error || 'Loading…'}</MemoryNote>
    </View>
  )
}
