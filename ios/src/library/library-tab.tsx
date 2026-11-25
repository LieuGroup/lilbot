/** Bot Details > Library tab (`R3-05`): wrapping All/Media/Files filter pills (AX5-safe), virtualized
 *  FlatList of Today / This week / Older grouped items, item viewer sheet, and workspace browser button. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlatList, Pressable, useWindowDimensions, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import type { LibraryItem } from '../../../shared/library-schema'
import { FolderIcon } from '../ui/details-icons'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../ui/dynamic-type'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { LibraryItemRow } from './library-item-row'
import { groupLibraryItems, LIBRARY_FILTERS, type LibraryFilter } from './library-lines'
import { LibraryViewerSheet } from './library-viewer-sheet'
import { useLibrary } from './use-library'
import { WorkspaceSheet } from './workspace-sheet'

type LibraryRowEntry =
  | { key: string; kind: 'header'; label: string }
  | { key: string; kind: 'item'; item: LibraryItem; isFirst: boolean; isLast: boolean }

export function LibraryTab({ bot, bottomPadding = 28 }: { bot: Bot; bottomPadding?: number }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const rowLines = rosterRowTextLines(fontScale)
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [openItem, setOpenItem] = useState<LibraryItem | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const { page, error, more, loadingMore } = useLibrary(bot.id, filter)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const rows = useMemo<LibraryRowEntry[]>(() => {
    if (!page) return []
    const groups = groupLibraryItems(page.items, now)
    const flat: LibraryRowEntry[] = []
    for (const group of groups) {
      flat.push({ key: `hdr:${group.label}`, kind: 'header', label: group.label })
      group.items.forEach((item, index) => {
        flat.push({ key: item.id, kind: 'item', item, isFirst: index === 0, isLast: index === group.items.length - 1 })
      })
    }
    return flat
  }, [now, page])

  const handleOpen = useCallback((item: LibraryItem) => setOpenItem(item), [])

  const renderEntry = useCallback(
    ({ item: entry }: { item: LibraryRowEntry }) => {
      if (entry.kind === 'header') {
        return (
          <AppText
            variant="name"
            color={theme.mutedForeground}
            maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.sectionHeader}
            style={[MOBILE_SCALE.details.sectionHeader, { paddingHorizontal: 4, paddingTop: 14, paddingBottom: 6 }]}
          >
            {entry.label}
          </AppText>
        )
      }
      return <LibraryItemRow item={entry.item} now={now} rowLines={rowLines} isFirst={entry.isFirst} isLast={entry.isLast} onPress={handleOpen} />
    },
    [handleOpen, now, rowLines, theme.mutedForeground]
  )

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        testID="bot-details-library"
        data={rows}
        keyExtractor={entry => entry.key}
        renderItem={renderEntry}
        initialNumToRender={16}
        windowSize={7}
        contentContainerStyle={{ padding: 16, flexGrow: 1, paddingBottom: bottomPadding }}
        ListHeaderComponent={
          <View style={{ gap: 12, paddingBottom: 4 }}>
            <View testID="library-filter-row" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {LIBRARY_FILTERS.map(entry => {
                const active = entry.id === filter
                return (
                  <Pressable
                    key={entry.id}
                    testID={`library-filter-${entry.id}`}
                    onPress={() => setFilter(entry.id)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={{ minHeight: 40, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? theme.foreground : theme.card, borderWidth: 1, borderColor: active ? theme.foreground : theme.hairline }}
                  >
                    <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.tabLabel} color={active ? theme.background : theme.foreground} style={[MOBILE_SCALE.details.tabLabel, { fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }]}>
                      {entry.label}
                    </AppText>
                  </Pressable>
                )
              })}
            </View>
            {!page ? (
              <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
                {error || 'Loading…'}
              </AppText>
            ) : rows.length === 0 ? (
              <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
                {filter === 'all' ? `Nothing here yet. Files and images ${bot.name} gives you appear here.` : `No ${filter} yet.`}
              </AppText>
            ) : null}
          </View>
        }
        ListFooterComponent={
          <View style={{ gap: 12, paddingTop: 16 }}>
            {page && page.nextOffset !== null ? (
              <Pressable disabled={loadingMore} onPress={() => void more()} accessibilityRole="button" style={{ alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 4 }}>
                <AppText variant="name" color={theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
                  {loadingMore ? 'Loading…' : 'Show more'}
                </AppText>
              </Pressable>
            ) : null}
            {page && error ? (
              <AppText variant="preview" color={theme.destructive} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { paddingHorizontal: 4 }]}>
                {error}
              </AppText>
            ) : null}
            <Pressable
              testID="library-browse-workspace"
              onPress={() => setWorkspaceOpen(true)}
              accessibilityRole="button"
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 54, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: theme.card, borderWidth: 1, borderColor: theme.hairline, opacity: pressed ? 0.65 : 1 })}
            >
              <FolderIcon color={theme.mutedForeground} size={17} />
              <AppText variant="name" numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
                Browse the whole workspace
              </AppText>
              <ChevronRightIcon color={theme.mutedForeground} size={15} />
            </Pressable>
          </View>
        }
      />
      <LibraryViewerSheet botId={bot.id} item={openItem} onClose={() => setOpenItem(null)} />
      <WorkspaceSheet botId={bot.id} visible={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
    </View>
  )
}
