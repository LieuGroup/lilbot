/** Pull-down / screen-reader Roster search bar, collapsible Unassigned/Hidden header,
 *  and zero-row-cost inline New bot (+) button for split surfaces. */
import { memo, type ReactNode, useCallback } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, PlusIcon, SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'

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

export const SplitNewBotButton = memo(function SplitNewBotButton({ onPress }: { onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable
      testID="roster-new-bot-button"
      onPress={onPress}
      hitSlop={{ top: 13, bottom: 13, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="New bot"
      style={({ pressed }) => ({
        width: 24,
        height: 18,
        borderRadius: 9,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1
      })}
    >
      <PlusIcon color={theme.mutedForeground} size={14} />
    </Pressable>
  )
})

export const RosterSearchBar = memo(function RosterSearchBar({
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
