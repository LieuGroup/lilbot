/** Virtualized Round 4 Roster (FlatList): 3-up pinned tiles flush at the top, active groups ("Working together"),
 *  non-sticky user sections, collapsed Unassigned/Hidden groups, scroll-gated row swipes without parent scroll re-renders,
 *  pull-down / screen-reader Search bots, and zero-row-height inline Search (+ New bot on split) on the first header line. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, type ListRenderItemInfo, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import type { Bot, Section } from '../../../shared/bot-schema'
import { useScreenReaderEnabled } from '../duo/use-surface'
import { shouldRevealSearch } from '../ui/gestures/rules'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { useBotMenuStore } from './menu-store'
import { CollapsedGroupHeader, RosterHeaderActions, RosterSearchBar, RosterSectionHeader, SplitNewBotFooter } from './roster-chrome'
import { buildRosterListItems, firstRosterHeaderKey, type RosterListItem, rosterHeaderActionsVisibility } from './roster-list'
import { RosterRow } from './roster-row'
import { RosterTiles } from './roster-tiles'
import { usePullToSearch } from './use-pull-to-search'
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

export function Roster({ bots, sections, loaded, connected, error, selectedId, compactCardSurface = false, splitMode = false, onSelect }: RosterProps) {
  const theme = useTheme()
  const screenReader = useScreenReaderEnabled()
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const actionError = useBotMenuStore(state => state.error)
  const setActionError = useBotMenuStore(state => state.setError)

  const scrollingVertically = useSharedValue(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [unassignedOpen, setUnassignedOpen] = useState(false)
  const [hiddenOpen, setHiddenOpen] = useState(false)

  useEffect(() => {
    if (!actionError) return
    const timer = setTimeout(() => setActionError(''), 6000)
    return () => clearTimeout(timer)
  }, [actionError, setActionError])

  const openSearch = useCallback(() => setSearchOpen(true), [])
  const closeSearch = useCallback(() => {
    setQuery('')
    setSearchOpen(false)
  }, [])

  const pullHandlers = usePullToSearch({ searchOpen, onRevealSearch: openSearch, scrollingVertically })

  const toggleGroup = useCallback((groupId: 'unassigned' | 'hidden') => {
    if (groupId === 'unassigned') setUnassignedOpen(open => !open)
    else setHiddenOpen(open => !open)
  }, [])

  const showSearchBar = shouldRevealSearch({ pullDistance: 0, alwaysVisible: screenReader || searchOpen || query.length > 0 })

  const items = useMemo(
    () => buildRosterListItems({ bots, sections, loaded, connected, error, query, selectedId, unassignedOpen, hiddenOpen }),
    [bots, sections, loaded, connected, error, query, selectedId, unassignedOpen, hiddenOpen]
  )

  const firstHeaderKey = useMemo(() => (query.trim().length === 0 ? firstRosterHeaderKey(items) : null), [items, query])
  const headerActionState = rosterHeaderActionsVisibility({ hasHeader: firstHeaderKey !== null, splitMode, searchVisible: showSearchBar })

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RosterListItem>) => {
      if (item.kind === 'tiles') return <RosterTiles bots={item.bots} selectedId={selectedId} compactCardSurface={compactCardSurface} onSelect={onSelect} />
      if (item.kind === 'groups') return <WorkingTogether groups={item.groups} compactCardSurface={compactCardSurface} onSelectBot={onSelect} />
      const headerActions =
        item.key === firstHeaderKey && (headerActionState.showSearch || headerActionState.showNewBot) ? (
          <RosterHeaderActions showSearch={headerActionState.showSearch} showNewBot={headerActionState.showNewBot} onOpenSearch={openSearch} onNewBot={openNewBot} />
        ) : undefined
      if (item.kind === 'section-header') return <RosterSectionHeader name={item.name} trailing={headerActions} />
      if (item.kind === 'group-toggle') {
        return <CollapsedGroupHeader testID={item.testID} groupId={item.groupId} name={item.name} count={item.count} open={item.open} onToggle={toggleGroup} trailing={headerActions} />
      }
      if (item.kind === 'notice') {
        return (
          <AppText variant="preview" color={item.tone === 'destructive' ? theme.destructive : theme.mutedForeground} style={{ textAlign: 'center', paddingHorizontal: 16, paddingVertical: 32 }}>
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
          scrollingVertically={scrollingVertically}
          onSelect={onSelect}
        />
      )
    },
    [compactCardSurface, firstHeaderKey, headerActionState.showNewBot, headerActionState.showSearch, onSelect, openNewBot, openSearch, scrollingVertically, selectedId, theme.destructive, theme.mutedForeground, toggleGroup]
  )

  const bannerError = actionError || (bots.length > 0 && error ? error : '')
  const header =
    showSearchBar || bannerError ? (
      <View>
        {showSearchBar && <RosterSearchBar query={query} canClose={searchOpen && !screenReader} autoFocus={searchOpen && !screenReader} onChange={setQuery} onClose={closeSearch} />}
        {bannerError ? (
          <View style={{ marginHorizontal: 12, marginTop: showSearchBar ? 0 : 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.destructive }}>
            <AppText variant="preview" color={theme.destructive}>
              {bannerError}
            </AppText>
          </View>
        ) : null}
      </View>
    ) : undefined

  const footer = splitMode && loaded && query.trim().length === 0 && !firstHeaderKey ? <SplitNewBotFooter onPress={openNewBot} /> : undefined

  return (
    <FlatList
      testID="roster-scroll"
      data={items}
      keyExtractor={item => item.key}
      renderItem={renderItem}
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      initialNumToRender={20}
      maxToRenderPerBatch={16}
      windowSize={7}
      onLayout={pullHandlers.onLayout}
      onScroll={pullHandlers.onScroll}
      onScrollBeginDrag={pullHandlers.onScrollBeginDrag}
      onScrollEndDrag={pullHandlers.onScrollEndDrag}
      onMomentumScrollBegin={pullHandlers.onMomentumScrollBegin}
      onMomentumScrollEnd={pullHandlers.onMomentumScrollEnd}
      contentContainerStyle={{ paddingBottom: 24 }}
    />
  )
}
