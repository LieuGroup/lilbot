/** Bot Details > Library tab (`R3-05`): All/Media/Files filter pills, items grouped by Today / This week / Older,
 *  item viewer sheet, and bottom "Browse the whole workspace" button. */
import { Fragment, useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import type { LibraryItem } from '../../../shared/library-schema'
import { FileTextIcon, FolderIcon, GlobeIcon, ImageIcon } from '../ui/details-icons'
import { RowDivider, SectionGroup } from '../ui/grouped-card'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { groupLibraryItems, LIBRARY_FILTERS, type LibraryFilter, libraryRowMeta } from './library-lines'
import { LibraryViewerSheet } from './library-viewer-sheet'
import { useLibrary } from './use-library'
import { WorkspaceSheet } from './workspace-sheet'

export function LibraryTab({ bot, bottomPadding = 28 }: { bot: Bot; bottomPadding?: number }) {
  const theme = useTheme()
  const [filter, setFilter] = useState<LibraryFilter>('all')
  const [openItem, setOpenItem] = useState<LibraryItem | null>(null)
  const [workspaceOpen, setWorkspaceOpen] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const { page, error, more, loadingMore } = useLibrary(bot.id, filter)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  const groups = page ? groupLibraryItems(page.items, now) : []

  return (
    <ScrollView testID="bot-details-library" contentContainerStyle={{ padding: 16, gap: 16, flexGrow: 1, paddingBottom: bottomPadding }}>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {LIBRARY_FILTERS.map(entry => {
          const active = entry.id === filter
          return (
            <Pressable
              key={entry.id}
              testID={`library-filter-${entry.id}`}
              onPress={() => setFilter(entry.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={{
                minHeight: 34,
                paddingHorizontal: 14,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? theme.foreground : theme.card,
                borderWidth: 1,
                borderColor: active ? theme.foreground : theme.hairline
              }}
            >
              <AppText variant="preview" color={active ? theme.background : theme.foreground} style={{ fontFamily: active ? 'Inter_500Medium' : 'Inter_400Regular' }}>
                {entry.label}
              </AppText>
            </Pressable>
          )
        })}
      </View>

      {!page ? (
        <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground} style={{ paddingHorizontal: 4 }}>
          {error || 'Loading…'}
        </AppText>
      ) : groups.length === 0 ? (
        <AppText variant="preview" color={theme.mutedForeground} style={{ paddingHorizontal: 4 }}>
          {filter === 'all' ? `Nothing here yet. Files and images ${bot.name} gives you appear here.` : `No ${filter} yet.`}
        </AppText>
      ) : (
        groups.map((group, groupIndex) => (
          <View key={group.label} style={{ gap: 6 }}>
            <SectionGroup title={group.label}>
              {group.items.map((item, index) => (
                <Fragment key={item.id}>
                  {index > 0 ? <RowDivider /> : null}
                  <Pressable
                    onPress={() => setOpenItem(item)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, minHeight: 50, opacity: pressed ? 0.65 : 1 })}
                  >
                    <ItemKindIcon kind={item.kind} color={theme.mutedForeground} />
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <AppText variant="preview" color={item.missing ? theme.mutedForeground : theme.foreground} style={{ fontFamily: 'Inter_500Medium' }} numberOfLines={1}>
                        {item.title}
                      </AppText>
                      <AppText variant="meta" color={item.missing ? theme.destructive : theme.mutedForeground} numberOfLines={1}>
                        {libraryRowMeta(item, now)}
                      </AppText>
                    </View>
                    <ChevronRightIcon color={theme.mutedForeground} size={14} />
                  </Pressable>
                </Fragment>
              ))}
            </SectionGroup>
            {groupIndex === groups.length - 1 && page.nextOffset !== null ? (
              <Pressable disabled={loadingMore} onPress={() => void more()} style={{ paddingHorizontal: 4, paddingVertical: 6 }}>
                <AppText variant="meta" color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
                  {loadingMore ? 'Loading…' : 'Show more'}
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ))
      )}

      {page && error ? (
        <AppText variant="meta" color={theme.destructive} style={{ paddingHorizontal: 4 }}>
          {error}
        </AppText>
      ) : null}

      <View style={{ flex: 1 }} />

      <Pressable
        testID="library-browse-workspace"
        onPress={() => setWorkspaceOpen(true)}
        accessibilityRole="button"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: 48,
          paddingHorizontal: 14,
          borderRadius: 14,
          backgroundColor: theme.card,
          borderWidth: 1,
          borderColor: theme.hairline,
          opacity: pressed ? 0.65 : 1
        })}
      >
        <FolderIcon color={theme.mutedForeground} size={16} />
        <AppText variant="preview" style={{ flex: 1 }}>
          Browse the whole workspace
        </AppText>
        <ChevronRightIcon color={theme.mutedForeground} size={14} />
      </Pressable>

      <LibraryViewerSheet botId={bot.id} item={openItem} onClose={() => setOpenItem(null)} />
      <WorkspaceSheet botId={bot.id} visible={workspaceOpen} onClose={() => setWorkspaceOpen(false)} />
    </ScrollView>
  )
}

function ItemKindIcon({ kind, color }: { kind: LibraryItem['kind']; color: string }) {
  if (kind === 'media') return <ImageIcon color={color} size={16} />
  if (kind === 'page') return <GlobeIcon color={color} size={16} />
  return <FileTextIcon color={color} size={16} />
}
