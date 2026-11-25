/** Virtualized Round 4 Roster (FlatList): large round pinned avatars flush at the top, active groups,
 *  collapsible user sections and Unassigned/Hidden groups, open two-line rows with scroll-gated swipes,
 *  and button-triggered Search bots (Duo strip button or ordinary iPhone/iPad first-section icon; no pull gesture). */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppState, FlatList, type ListRenderItemInfo, View } from 'react-native'
import { useSharedValue } from 'react-native-reanimated'
import type { Bot, Section } from '../../../shared/bot-schema'
import { closeAllSwipeRows } from '../ui/gestures/swipe-row'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { useBotMenuStore } from './menu-store'
import { CollapsedGroupHeader, RosterHeaderActions, RosterSearchBar, RosterSectionHeader, SplitNewBotFooter } from './roster-chrome'
import { buildRosterListItems, firstRosterHeaderKey, type RosterListItem, rosterHeaderActionsVisibility, standaloneRosterHeaderActions } from './roster-list'
import { createDayRolloverController } from './roster-preview'
import { RosterRow } from './roster-row'
import { RosterTiles } from './roster-tiles'
import { WorkingTogether } from './working-together'

interface RosterProps {
  bots: Bot[]
  sections: Section[]
  loaded: boolean
  connected: boolean
  error: string
  selectedId: string | null
  splitMode?: boolean
  hideInlineSearch?: boolean
  hideInlineNewBot?: boolean
  searchOpen: boolean
  searchQuery: string
  onChangeSearchQuery: (query: string) => void
  onOpenSearch: () => void
  onCloseSearch: () => void
  onSelect: (bot: Bot) => void
}

export function Roster({
  bots,
  sections,
  loaded,
  connected,
  error,
  selectedId,
  splitMode = false,
  hideInlineSearch = false,
  hideInlineNewBot = false,
  searchOpen,
  searchQuery,
  onChangeSearchQuery,
  onOpenSearch,
  onCloseSearch,
  onSelect
}: RosterProps) {
  const theme = useTheme()
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const keyboardHeight = useKeyboardHeight(searchOpen)
  const actionError = useBotMenuStore(state => state.error)
  const setActionError = useBotMenuStore(state => state.setError)

  const scrollingVertically = useSharedValue(false)
  const [unassignedOpen, setUnassignedOpen] = useState(false)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [dayAnchor, setDayAnchor] = useState(() => Date.now())

  useEffect(() => {
    const rollover = createDayRolloverController({ onDayChange: setDayAnchor })
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') rollover.sync()
    })
    return () => {
      rollover.stop()
      sub.remove()
    }
  }, [])

  useEffect(() => {
    if (!actionError) return
    const timer = setTimeout(() => setActionError(''), 6000)
    return () => clearTimeout(timer)
  }, [actionError, setActionError])

  const toggleGroup = useCallback((groupId: 'unassigned' | 'hidden') => {
    if (groupId === 'unassigned') setUnassignedOpen(open => !open)
    else setHiddenOpen(open => !open)
  }, [])

  const toggleSection = useCallback((sectionId: string) => {
    setCollapsedSections(prev => ({ ...prev, [sectionId]: !prev[sectionId] }))
  }, [])

  const handleScrollBegin = useCallback(() => {
    scrollingVertically.value = true
    closeAllSwipeRows()
  }, [scrollingVertically])

  const handleScrollEnd = useCallback(() => {
    scrollingVertically.value = false
  }, [scrollingVertically])

  const items = useMemo(
    () => buildRosterListItems({ bots, sections, loaded, connected, error, query: searchOpen ? searchQuery : '', selectedId, unassignedOpen, hiddenOpen, collapsedSections }),
    [bots, collapsedSections, connected, error, hiddenOpen, loaded, searchOpen, searchQuery, sections, selectedId, unassignedOpen]
  )

  const firstHeaderKey = useMemo(() => (searchQuery.trim().length === 0 || !searchOpen ? firstRosterHeaderKey(items) : null), [items, searchOpen, searchQuery])
  const headerActionState = rosterHeaderActionsVisibility({
    hasHeader: firstHeaderKey !== null,
    splitMode,
    searchVisible: searchOpen,
    hideInlineSearch,
    hideInlineNewBot
  })
  const standaloneActions = standaloneRosterHeaderActions({
    hasHeader: firstHeaderKey !== null,
    hasBots: bots.length > 0,
    splitMode,
    searchVisible: searchOpen,
    hideInlineSearch,
    hideInlineNewBot
  })

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<RosterListItem>) => {
      if (item.kind === 'tiles') return <RosterTiles bots={item.bots} selectedId={selectedId} splitMode={splitMode} onSelect={onSelect} />
      if (item.kind === 'groups') return <WorkingTogether groups={item.groups} splitMode={splitMode} onSelectBot={onSelect} />
      const headerActions =
        item.key === firstHeaderKey && (headerActionState.showSearch || headerActionState.showNewBot) ? (
          <RosterHeaderActions showSearch={headerActionState.showSearch} showNewBot={headerActionState.showNewBot} onOpenSearch={onOpenSearch} onNewBot={openNewBot} />
        ) : undefined
      if (item.kind === 'section-header') {
        return <RosterSectionHeader sectionId={item.sectionId} name={item.name} open={item.open} onToggle={toggleSection} trailing={headerActions} />
      }
      if (item.kind === 'group-toggle') {
        return <CollapsedGroupHeader testID={item.testID} groupId={item.groupId} name={item.name} count={item.count} open={item.open} onToggle={toggleGroup} trailing={headerActions} />
      }
      if (item.kind === 'notice') {
        return (
          <AppText style={{ ...MOBILE_SCALE.roster.rowPreview, textAlign: 'center', paddingHorizontal: 16, paddingVertical: 32 }} color={item.tone === 'destructive' ? theme.destructive : theme.mutedForeground}>
            {item.text}
          </AppText>
        )
      }
      return <RosterRow bot={item.bot} selected={item.bot.id === selectedId} splitMode={splitMode} spacedTop={item.spacedTop} now={dayAnchor} scrollingVertically={scrollingVertically} onSelect={onSelect} />
    },
    [dayAnchor, firstHeaderKey, headerActionState.showNewBot, headerActionState.showSearch, onOpenSearch, onSelect, openNewBot, scrollingVertically, selectedId, splitMode, theme.destructive, theme.mutedForeground, toggleGroup, toggleSection]
  )

  const bannerError = actionError || (bots.length > 0 && error ? error : '')
  const showStandaloneBar = standaloneActions.showSearch || standaloneActions.showNewBot
  const header =
    searchOpen || showStandaloneBar || bannerError ? (
      <View>
        {searchOpen && <RosterSearchBar query={searchQuery} autoFocus onChange={onChangeSearchQuery} onClose={onCloseSearch} />}
        {showStandaloneBar && (
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
            <RosterHeaderActions showSearch={standaloneActions.showSearch} showNewBot={standaloneActions.showNewBot} onOpenSearch={onOpenSearch} onNewBot={openNewBot} />
          </View>
        )}
        {bannerError ? (
          <View style={{ marginHorizontal: 16, marginTop: searchOpen || showStandaloneBar ? 0 : 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.destructive }}>
            <AppText style={MOBILE_SCALE.roster.rowPreview} color={theme.destructive}>
              {bannerError}
            </AppText>
          </View>
        ) : null}
      </View>
    ) : undefined

  const footer = splitMode && !hideInlineNewBot && loaded && (!searchOpen || searchQuery.trim().length === 0) && !firstHeaderKey && !standaloneActions.showNewBot ? <SplitNewBotFooter onPress={openNewBot} /> : undefined

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
      {...KEYBOARD_SCROLL_PROPS}
      scrollIndicatorInsets={{ bottom: keyboardHeight }}
      initialNumToRender={20}
      maxToRenderPerBatch={16}
      windowSize={7}
      onScrollBeginDrag={handleScrollBegin}
      onScrollEndDrag={handleScrollEnd}
      onMomentumScrollBegin={handleScrollBegin}
      onMomentumScrollEnd={handleScrollEnd}
      contentContainerStyle={{ paddingBottom: sheetScrollBottomPadding(28, keyboardHeight) }}
    />
  )
}
