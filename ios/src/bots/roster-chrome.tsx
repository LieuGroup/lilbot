/** Pull-down / screen-reader Roster search bar, collapsible Unassigned/Hidden header,
 *  and zero-row-height inline header actions (Search bots when bar is hidden, plus New bot on split). */
import { memo, type ReactNode, useCallback } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, PlusIcon, SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'

const HEADER_ACTION_SLOP = { top: 14, bottom: 14, left: 8, right: 8 } as const

export const SplitNewBotFooter = memo(function SplitNewBotFooter({ onPress }: { onPress: () => void }) {
  const theme = useTheme()
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 12, alignItems: 'flex-start' }}>
      <Pressable
        testID="roster-new-bot-button"
        onPress={onPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="New bot"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 44, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
      >
        <PlusIcon color={theme.mutedForeground} size={14} />
        <AppText variant="meta" color={theme.mutedForeground} style={{ fontFamily: 'Inter_500Medium' }}>
          New bot
        </AppText>
      </Pressable>
    </View>
  )
})

/** Quiet muted actions aligned to the right end of the first roster header line at 0 pt extra row height
 *  (each 28x16 with 14/8 hitSlop -> non-overlapping 44x44 pt hit targets). */
export const RosterHeaderActions = memo(function RosterHeaderActions({
  showSearch,
  showNewBot,
  onOpenSearch,
  onNewBot
}: {
  showSearch: boolean
  showNewBot: boolean
  onOpenSearch: () => void
  onNewBot: () => void
}) {
  const theme = useTheme()
  if (!showSearch && !showNewBot) return null
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
      {showSearch && (
        <Pressable
          testID="roster-search-button"
          onPress={onOpenSearch}
          hitSlop={HEADER_ACTION_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Search bots"
          style={({ pressed }) => ({
            width: 28,
            height: 16,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1
          })}
        >
          <SearchIcon color={theme.mutedForeground} size={14} />
        </Pressable>
      )}
      {showNewBot && (
        <Pressable
          testID="roster-new-bot-button"
          onPress={onNewBot}
          hitSlop={HEADER_ACTION_SLOP}
          accessibilityRole="button"
          accessibilityLabel="New bot"
          style={({ pressed }) => ({
            width: 28,
            height: 16,
            borderRadius: 8,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1
          })}
        >
          <PlusIcon color={theme.mutedForeground} size={14} />
        </Pressable>
      )}
    </View>
  )
})

export const RosterSearchBar = memo(function RosterSearchBar({
  query,
  canClose,
  autoFocus,
  onChange,
  onClose
}: {
  query: string
  canClose: boolean
  autoFocus: boolean
  onChange: (value: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  return (
    <View style={{ paddingHorizontal: 12, paddingTop: 6, paddingBottom: 8 }}>
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
          autoFocus={autoFocus}
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
})

export const RosterSectionHeader = memo(function RosterSectionHeader({ name, trailing }: { name: string; trailing?: ReactNode }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
      <AppText variant="meta" color={theme.mutedForeground} style={{ fontFamily: 'Inter_500Medium' }}>
        {name}
      </AppText>
      {trailing}
    </View>
  )
})

export const CollapsedGroupHeader = memo(function CollapsedGroupHeader({
  testID,
  groupId,
  name,
  count,
  open,
  onToggle,
  trailing
}: {
  testID: string
  groupId: 'unassigned' | 'hidden'
  name: string
  count: number
  open: boolean
  onToggle: (groupId: 'unassigned' | 'hidden') => void
  trailing?: ReactNode
}) {
  const theme = useTheme()
  const handlePress = useCallback(() => onToggle(groupId), [groupId, onToggle])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}>
      <Pressable
        testID={testID}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${name}, ${count}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
      >
        {open ? <ChevronDownIcon color={theme.mutedForeground} size={13} /> : <ChevronRightIcon color={theme.mutedForeground} size={13} />}
        <AppText variant="meta" color={theme.mutedForeground} style={{ fontFamily: 'Inter_500Medium' }}>
          {name} · {count}
        </AppText>
      </Pressable>
      {trailing}
    </View>
  )
})
