/** Virtualized Round 4 Roster (FlatList): 3-up pinned tiles, active groups ("Working together"),
 *  non-sticky user sections, collapsed Unassigned/Hidden groups, scroll-gated row swipes without parent scroll re-renders,
 *  pull-down Search bots, and always-visible Search / Manage fallbacks. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import type { Bot, Section } from '../../../shared/bot-schema'
import { useScreenReaderEnabled } from '../duo/use-surface'
import { shouldRevealSearch } from '../ui/gestures/rules'
import { closeAllSwipeRows } from '../ui/gestures/swipe-row'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { useBotMenuStore } from './menu-store'
import { CollapsedGroupHeader, RosterSearchBar, RosterUtilityBar } from './roster-chrome'
import { RosterRow } from './roster-row'
import { buildRosterListItems, type RosterListItem } from './roster-list'
import { RosterTiles } from './roster-tiles'
import { WorkingTogether } from './working-together'

interface RosterProps {
  bots: Bot[]
  sections: Section[]
  loaded: boolean
  connected: boolean
  error: string
  selectedId: string | null
  compactCardSurface?: boolean
  splitMode?: boolean
  onSelect: (bot: Bot) => void
}

export function Roster({
  bots,
  sections,
  loaded,
  connected,
  error,
  selectedId,
  compactCardSurface = false,
  splitMode = false,
  onSelect
}: RosterProps) {
  const theme = useTheme()
  const screenReader = useScreenReaderEnabled()
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const actionError = useBotMenuStore(state => state.error)
  const setActionError = useBotMenuStore(state => state.setError)

  const scrollingVertically = useSharedValue(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [manageMode, setManageMode] = useState(false)
  const [query, setQuery] = useState('')
  const [unassignedOpen, setUnassignedOpen] = useState(false)
  const [hiddenOpen, setHiddenOpen] = useState(false)

  useEffect(() => {
    if (!actionError) return
    const timer = setTimeout(() => setActionError(''), 6000)
    return () => clearTimeout(timer)
  }, [actionError, setActionError])

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (searchOpen) return
      if (shouldRevealSearch({ pullDistance: -event.nativeEvent.contentOffset.y, alwaysVisible: false })) setSearchOpen(true)
    },
    [searchOpen]
  )

  const handleScrollStart = useCallback(() => {
    scrollingVertically.value = true
    closeAllSwipeRows()
  }, [scrollingVertically])

  const handleScrollEnd = useCallback(() => {
    scrollingVertically.value = false
  }, [scrollingVertically])

  const toggleGroup = useCallback((groupId: 'unassigned' | 'hidden') => {
    if (groupId === 'unassigned') setUnassignedOpen(open => !open)
    else setHiddenOpen(open => !open)
  }, [])

  const showSearchBar = shouldRevealSearch({ pullDistance: 0, alwaysVisible: screenReader || searchOpen || query.length > 0 })
  const toggleSearch = useCallback(() => {
    if (searchOpen || query.length > 0) {
      setQuery('')
      setSearchOpen(false)
    } else {
      setSearchOpen(true)
    }
  }, [query.length, searchOpen])

  const toggleManage = useCallback(() => {
    closeAllSwipeRows()
    setManageMode(open => !open)
  }, [])

  const items = useMemo(
    () => buildRosterListItems({ bots, sections, loaded, connected, error, query, selectedId, unassignedOpen, hiddenOpen }),
    [bots, sections, loaded, connected, error, query, selectedId, unassignedOpen, hiddenOpen]
  )

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RosterListItem>) => {
      if (item.kind === 'tiles') {
        return <RosterTiles bots={item.bots} selectedId={selectedId} compactCardSurface={compactCardSurface} manageMode={manageMode} onSelect={onSelect} />
      }
      if (item.kind === 'groups') {
        return <WorkingTogether groups={item.groups} compactCardSurface={compactCardSurface} onSelectBot={onSelect} />
      }
      if (item.kind === 'section-header') {
        return (
          <View style={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
            <AppText variant="meta" color={theme.mutedForeground} style={{ fontFamily: 'Inter_500Medium' }}>
              {item.name}
            </AppText>
          </View>
        )
      }
      if (item.kind === 'group-toggle') {
        return <CollapsedGroupHeader testID={item.testID} name={item.name} count={item.count} open={item.open} onToggle={() => toggleGroup(item.groupId)} />
      }
      if (item.kind === 'notice') {
        return (
          <AppText
            variant="preview"
            color={item.tone === 'destructive' ? theme.destructive : theme.mutedForeground}
            style={{ textAlign: 'center', paddingHorizontal: 16, paddingVertical: 32 }}
          >
            {item.text}
          </AppText>
        )
      }
      return (
        <RosterRow
          bot={item.bot}
          selected={item.bot.id === selectedId}
          compactCardSurface={compactCardSurface}
          isFirst={item.isFirst}
          isLast={item.isLast}
          spacedTop={item.spacedTop}
          manageMode={manageMode}
          scrollingVertically={scrollingVertically}
          onSelect={onSelect}
        />
      )
    },
    [compactCardSurface, manageMode, onSelect, scrollingVertically, selectedId, theme.destructive, theme.mutedForeground, toggleGroup]
  )

  const bannerError = actionError || (bots.length > 0 && error ? error : '')
  const header = (
    <View>
      <RosterUtilityBar showNewBot={splitMode} searchOpen={showSearchBar} manageMode={manageMode} onNewBot={openNewBot} onToggleSearch={toggleSearch} onToggleManage={toggleManage} />
      {showSearchBar && <RosterSearchBar query={query} canClose={searchOpen && !screenReader} onChange={setQuery} onClose={toggleSearch} />}
      {bannerError ? (
        <View style={{ marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.destructive }}>
          <AppText variant="preview" color={theme.destructive}>{bannerError}</AppText>
        </View>
      ) : null}
    </View>
  )

  return (
    <FlatList
      testID="roster-scroll"
      data={items}
      keyExtractor={item => item.key}
      renderItem={renderItem}
      ListHeaderComponent={header}
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      initialNumToRender={20}
      maxToRenderPerBatch={16}
      windowSize={7}
      onScroll={handleScroll}
      onScrollBeginDrag={handleScrollStart}
      onScrollEndDrag={handleScrollEnd}
      onMomentumScrollBegin={handleScrollStart}
      onMomentumScrollEnd={handleScrollEnd}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  )
}
