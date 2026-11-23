/** Roster search bar, always-visible fallback utility bar (Search, Manage, and split-mode New bot),
 *  and collapsible Unassigned/Hidden section header. */
import { memo } from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, MoreHorizontalIcon, PlusIcon, SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'

/** Compact top-right utility strip ensuring Search and Bot menu are always reachable without gestures,
 *  and exposing New bot (+) in split surfaces where the detached native rail orb holds New chat. */
export const RosterUtilityBar = memo(function RosterUtilityBar({
  showNewBot,
  searchOpen,
  manageMode,
  onNewBot,
  onToggleSearch,
  onToggleManage
}: {
  showNewBot: boolean
  searchOpen: boolean
  manageMode: boolean
  onNewBot: () => void
  onToggleSearch: () => void
  onToggleManage: () => void
}) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingTop: 2, paddingBottom: 2 }}>
      {showNewBot && (
        <Pressable
          testID="roster-new-bot-button"
          onPress={onNewBot}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="New bot"
          style={({ pressed }) => ({
            width: 32,
            height: 32,
            borderRadius: 16,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: pressed ? 0.6 : 1
          })}
        >
          <PlusIcon color={theme.mutedForeground} size={16} />
        </Pressable>
      )}
      <Pressable
        testID="roster-search-button"
        onPress={onToggleSearch}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Search bots"
        accessibilityState={{ expanded: searchOpen }}
        style={({ pressed }) => ({
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: searchOpen ? theme.muted : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1
        })}
      >
        <SearchIcon color={searchOpen ? theme.foreground : theme.mutedForeground} size={15} />
      </Pressable>
      <Pressable
        testID="roster-manage-button"
        onPress={onToggleManage}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={manageMode ? 'Done managing bots' : 'Manage bots'}
        accessibilityState={{ selected: manageMode }}
        style={({ pressed }) => ({
          minWidth: 32,
          height: 32,
          paddingHorizontal: manageMode ? 10 : 0,
          borderRadius: 16,
          backgroundColor: manageMode ? theme.muted : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.6 : 1
        })}
      >
        {manageMode ? (
          <AppText variant="meta" color={theme.foreground} style={{ fontFamily: 'Inter_600SemiBold' }}>
            Done
          </AppText>
        ) : (
          <MoreHorizontalIcon color={theme.mutedForeground} size={16} />
        )}
      </Pressable>
    </View>
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
})

export const CollapsedGroupHeader = memo(function CollapsedGroupHeader({
  testID,
  name,
  count,
  open,
  onToggle
}: {
  testID: string
  name: string
  count: number
  open: boolean
  onToggle: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      testID={testID}
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${name}, ${count}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 }}
    >
      {open ? <ChevronDownIcon color={theme.mutedForeground} size={13} /> : <ChevronRightIcon color={theme.mutedForeground} size={13} />}
      <AppText variant="meta" color={theme.mutedForeground} style={{ fontFamily: 'Inter_500Medium' }}>
        {name} · {count}
      </AppText>
    </Pressable>
  )
})
