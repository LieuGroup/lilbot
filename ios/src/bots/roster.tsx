/** Round 4 Roster (R4-03a, R4-01a, R4-02a, R4-G2, R4-G4): 3-up pinned tiles, active groups ("Working together"),
 *  non-sticky user sections, collapsed Unassigned/Hidden groups, scroll-gated row swipes, and pull-down Search bots. */
import { useCallback, useEffect, useState } from 'react'
import { type NativeScrollEvent, type NativeSyntheticEvent, Pressable, ScrollView, View } from 'react-native'
import type { Bot, Section } from '../../../shared/bot-schema'
import { rosterGroups, searchBots } from '../../../shared/client/bots/roster-groups'
import { useScreenReaderEnabled } from '../duo/use-surface'
import { shouldRevealSearch } from '../ui/gestures/rules'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { useBotMenuStore } from './menu-store'
import { CollapsedGroup, RosterSearchBar, RowGroup } from './roster-chrome'
import { RosterRow } from './roster-row'
import { RosterTiles } from './roster-tiles'
import { WorkingTogether } from './working-together'

interface RosterProps {
  bots: Bot[]
  sections: Section[]
  selectedId: string | null
  compactCardSurface?: boolean
  onSelect: (bot: Bot) => void
}

export function Roster({ bots, sections, selectedId, compactCardSurface = false, onSelect }: RosterProps) {
  const theme = useTheme()
  const screenReader = useScreenReaderEnabled()
  const openSectionDialog = useBotMenuStore(state => state.openSectionDialog)
  const actionError = useBotMenuStore(state => state.error)
  const setActionError = useBotMenuStore(state => state.setError)

  const [scrolling, setScrolling] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
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

  const groups = rosterGroups(bots, sections)
  const sectioned = groups.sections.length > 0
  const showSearchBar = shouldRevealSearch({ pullDistance: 0, alwaysVisible: screenReader || searchOpen || query.length > 0 })
  const filtering = query.trim().length > 0
  const matches = filtering ? searchBots(bots, query) : []
  const unassignedExpanded = unassignedOpen || groups.unassigned.some(bot => bot.id === selectedId)
  const hiddenExpanded = hiddenOpen || groups.hidden.some(bot => bot.id === selectedId)

  const renderRows = (list: Bot[]) => (
    <RowGroup compactCardSurface={compactCardSurface}>
      {list.map((bot, index) => (
        <RosterRow
          key={bot.id}
          bot={bot}
          selected={bot.id === selectedId}
          compactCardSurface={compactCardSurface}
          showDivider={index > 0}
          scrollingVertically={scrolling}
          onSelect={onSelect}
        />
      ))}
    </RowGroup>
  )

  return (
    <ScrollView
      testID="roster-scroll"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      scrollEventThrottle={32}
      onScroll={handleScroll}
      onScrollBeginDrag={() => setScrolling(true)}
      onScrollEndDrag={() => setScrolling(false)}
      onMomentumScrollBegin={() => setScrolling(true)}
      onMomentumScrollEnd={() => setScrolling(false)}
      contentContainerStyle={{ paddingTop: 4, paddingBottom: 24 }}
    >
      {showSearchBar && (
        <RosterSearchBar
          query={query}
          canClose={searchOpen && !screenReader}
          onChange={setQuery}
          onClose={() => {
            setQuery('')
            setSearchOpen(false)
          }}
        />
      )}

      {actionError ? (
        <View style={{ marginHorizontal: 12, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.destructive }}>
          <AppText variant="preview" color={theme.destructive}>
            {actionError}
          </AppText>
        </View>
      ) : null}

      {filtering ? (
        matches.length > 0 ? (
          renderRows(matches)
        ) : (
          <AppText variant="preview" color={theme.mutedForeground} style={{ paddingHorizontal: 16, paddingVertical: 20 }}>
            No bot matches.
          </AppText>
        )
      ) : (
        <>
          {groups.tiled ? <RosterTiles bots={groups.top} selectedId={selectedId} compactCardSurface={compactCardSurface} onSelect={onSelect} /> : groups.top.length > 0 && renderRows(groups.top)}
          <WorkingTogether bots={bots} compactCardSurface={compactCardSurface} onSelectBot={onSelect} />
          {groups.sections.map(({ section, bots: group }) => (
            <View key={section.id} style={{ marginTop: 10 }}>
              <Pressable
                onLongPress={() => openSectionDialog({ kind: 'rename', sectionId: section.id, name: section.name })}
                delayLongPress={320}
                accessibilityLabel={`${section.name} section`}
                accessibilityHint="Long press to rename or delete section"
                style={{ paddingHorizontal: 16, paddingBottom: 4 }}
              >
                <AppText variant="meta" color={theme.mutedForeground} style={{ fontFamily: 'Inter_500Medium' }}>
                  {section.name}
                </AppText>
              </Pressable>
              {renderRows(group)}
            </View>
          ))}
          {sectioned
            ? groups.unassigned.length > 0 && (
                <CollapsedGroup
                  testID="roster-group-unassigned"
                  name="Unassigned"
                  count={groups.unassigned.length}
                  open={unassignedExpanded}
                  onToggle={() => setUnassignedOpen(open => !open)}
                >
                  {renderRows(groups.unassigned)}
                </CollapsedGroup>
              )
            : groups.unassigned.length > 0 && <View style={{ marginTop: groups.top.length > 0 ? 8 : 0 }}>{renderRows(groups.unassigned)}</View>}
          {groups.hidden.length > 0 && (
            <CollapsedGroup testID="roster-group-hidden" name="Hidden" count={groups.hidden.length} open={hiddenExpanded} onToggle={() => setHiddenOpen(open => !open)}>
              {renderRows(groups.hidden)}
            </CollapsedGroup>
          )}
          {bots.length === 0 && (
            <AppText variant="chat" color={theme.mutedForeground} style={{ textAlign: 'center', marginTop: 40 }}>
              No bots yet.
            </AppText>
          )}
        </>
      )}
    </ScrollView>
  )
}
