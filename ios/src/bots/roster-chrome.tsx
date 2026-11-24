/** Roster search bar, collapsible section and Unassigned/Hidden headers, and inline header actions
 *  (Search bots on ordinary iPhone/iPad when the bar is hidden, plus New bot on non-Duo split). */
import { memo, type ReactNode, useCallback } from 'react'
import { Keyboard, Pressable, TextInput, View } from 'react-native'
import { ChevronDownIcon, ChevronRightIcon, CloseIcon, PlusIcon, SearchIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'

const HEADER_ACTION_SLOP = { top: 14, bottom: 14, left: 8, right: 8 } as const
const SECTION_SLOP = { top: 10, bottom: 10, left: 6, right: 12 } as const

export const SplitNewBotFooter = memo(function SplitNewBotFooter({ onPress }: { onPress: () => void }) {
  const theme = useTheme()
  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 14, alignItems: 'flex-start' }}>
      <Pressable
        testID="roster-new-bot-button"
        onPress={onPress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="New bot"
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 44, paddingVertical: 6, opacity: pressed ? 0.6 : 1 })}
      >
        <PlusIcon color={theme.mutedForeground} size={15} />
        <AppText style={{ ...MOBILE_SCALE.roster.sectionHeader, fontFamily: 'Inter_500Medium' }} color={theme.mutedForeground}>
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
          style={({ pressed }) => ({ width: 28, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <SearchIcon color={theme.mutedForeground} size={16} />
        </Pressable>
      )}
      {showNewBot && (
        <Pressable
          testID="roster-new-bot-button"
          onPress={onNewBot}
          hitSlop={HEADER_ACTION_SLOP}
          accessibilityRole="button"
          accessibilityLabel="New bot"
          style={({ pressed }) => ({ width: 28, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
        >
          <PlusIcon color={theme.mutedForeground} size={16} />
        </Pressable>
      )}
    </View>
  )
})

export const RosterSearchBar = memo(function RosterSearchBar({
  query,
  autoFocus,
  onChange,
  onClose
}: {
  query: string
  autoFocus: boolean
  onChange: (value: string) => void
  onClose: () => void
}) {
  const theme = useTheme()
  const handleClose = useCallback(() => {
    Keyboard.dismiss()
    onClose()
  }, [onClose])

  return (
    <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingLeft: 14, paddingRight: 4, borderRadius: radius.pill, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.border }}>
        <SearchIcon color={theme.mutedForeground} size={17} />
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
          style={{ flex: 1, fontFamily: 'Inter_400Regular', ...MOBILE_SCALE.roster.rowPreview, color: theme.foreground, paddingVertical: 8 }}
        />
        <Pressable
          testID="roster-search-close"
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close search"
          style={({ pressed }) => ({ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.55 : 1 })}
        >
          <CloseIcon color={theme.mutedForeground} size={16} />
        </Pressable>
      </View>
    </View>
  )
})

export const RosterSectionHeader = memo(function RosterSectionHeader({ sectionId, name, open, onToggle, trailing }: { sectionId: string; name: string; open: boolean; onToggle: (sectionId: string) => void; trailing?: ReactNode }) {
  const theme = useTheme()
  const handlePress = useCallback(() => onToggle(sectionId), [onToggle, sectionId])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 }}>
      <Pressable testID={`roster-section-${sectionId}`} onPress={handlePress} hitSlop={SECTION_SLOP} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={name} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
        <AppText style={{ ...MOBILE_SCALE.roster.sectionHeader, fontFamily: 'Inter_500Medium' }} color={theme.mutedForeground}>
          {name}
        </AppText>
        {open ? <ChevronDownIcon color={theme.mutedForeground} size={14} /> : <ChevronRightIcon color={theme.mutedForeground} size={14} />}
      </Pressable>
      {trailing}
    </View>
  )
})

export const CollapsedGroupHeader = memo(function CollapsedGroupHeader({ testID, groupId, name, count, open, onToggle, trailing }: { testID: string; groupId: 'unassigned' | 'hidden'; name: string; count: number; open: boolean; onToggle: (groupId: 'unassigned' | 'hidden') => void; trailing?: ReactNode }) {
  const theme = useTheme()
  const handlePress = useCallback(() => onToggle(groupId), [groupId, onToggle])
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 18, paddingBottom: 6 }}>
      <Pressable testID={testID} onPress={handlePress} hitSlop={SECTION_SLOP} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${name}, ${count}`} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: pressed ? 0.6 : 1 })}>
        <AppText style={{ ...MOBILE_SCALE.roster.sectionHeader, fontFamily: 'Inter_500Medium' }} color={theme.mutedForeground}>
          {name} · {count}
        </AppText>
        {open ? <ChevronDownIcon color={theme.mutedForeground} size={14} /> : <ChevronRightIcon color={theme.mutedForeground} size={14} />}
      </Pressable>
      {trailing}
    </View>
  )
})
