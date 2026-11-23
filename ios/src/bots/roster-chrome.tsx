/** Roster search bar (R4-G4 pull-down + VoiceOver fallback), row group wrapper, and collapsible Unassigned/Hidden groups. */
import type { ReactNode } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'

export function RosterSearchBar({
  query,
  canClose,
  onChange,
  onClose
}: {
  query: string
  canClose: boolean
  onChange: (value: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  return (
    <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          height: 40,
          paddingHorizontal: 12,
          borderRadius: radius.pill,
          backgroundColor: theme.card,
          borderWidth: 1,
          borderColor: theme.border
        }}
      >
        <SearchIcon color={theme.mutedForeground} size={16} />
        <TextInput
          testID="roster-search-input"
          value={query}
          onChangeText={onChange}
          placeholder="Search bots"
          placeholderTextColor={theme.mutedForeground}
          autoCorrect={false}
          clearButtonMode="never"
          accessibilityLabel="Search bots"
          style={{ flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: theme.foreground, paddingVertical: 0 }}
        />
        {(query.length > 0 || canClose) && (
          <Pressable
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close search"
            style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}
          >
            <CloseIcon color={theme.mutedForeground} size={14} />
          </Pressable>
        )}
      </View>
    </View>
  )
}

export function RowGroup({ compactCardSurface, children }: { compactCardSurface: boolean; children: ReactNode }) {
  const theme = useTheme()
  if (compactCardSurface) {
    return (
      <View style={{ paddingHorizontal: 12 }}>
        <View style={{ backgroundColor: theme.card, borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, overflow: 'hidden' }}>{children}</View>
      </View>
    )
  }
  return <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.hairline }}>{children}</View>
}

export function CollapsedGroup({
  testID,
  name,
  count,
  open,
  onToggle,
  children
}: {
  testID: string
  name: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const theme = useTheme()
  return (
    <View style={{ marginTop: 12 }}>
      <Pressable
        testID={testID}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${count}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingVertical: 6 }}
      >
        {open ? <ChevronDownIcon color={theme.mutedForeground} size={13} /> : <ChevronRightIcon color={theme.mutedForeground} size={13} />}
        <AppText variant="meta" color={theme.mutedForeground} style={{ fontFamily: 'Inter_500Medium' }}>
          {name} · {count}
        </AppText>
      </Pressable>
      {open ? children : null}
    </View>
  )
}
