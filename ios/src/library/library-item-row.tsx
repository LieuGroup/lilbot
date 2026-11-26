/** Memoized Library item row used inside `LibraryTab`'s virtualized FlatList, on `MOBILE_SCALE.details`. */
import { memo } from 'react'
import { Pressable, View } from 'react-native'
import type { LibraryItem } from '../../../shared/library-schema'
import { FileTextIcon, GlobeIcon, ImageIcon } from '../ui/details-icons'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { libraryRowMeta } from './library-lines'

export const LibraryItemRow = memo(function LibraryItemRow({
  item,
  now,
  rowLines,
  isFirst,
  isLast,
  onPress
}: {
  item: LibraryItem
  now: number
  rowLines: 1 | 2
  isFirst: boolean
  isLast: boolean
  onPress: (item: LibraryItem) => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={() => onPress(item)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: 56,
        backgroundColor: theme.card,
        borderLeftWidth: 1,
        borderRightWidth: 1,
        borderTopWidth: 1,
        borderBottomWidth: isLast ? 1 : 0,
        borderColor: theme.hairline,
        borderTopLeftRadius: isFirst ? 14 : 0,
        borderTopRightRadius: isFirst ? 14 : 0,
        borderBottomLeftRadius: isLast ? 14 : 0,
        borderBottomRightRadius: isLast ? 14 : 0,
        opacity: pressed ? 0.65 : 1
      })}
    >
      <ItemKindIcon kind={item.kind} color={theme.mutedForeground} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <AppText variant="name" color={item.missing ? theme.mutedForeground : theme.foreground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          {item.title}
        </AppText>
        <AppText variant="preview" color={item.missing ? theme.destructive : theme.mutedForeground} numberOfLines={rowLines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.rowSubtitle}>
          {libraryRowMeta(item, now)}
        </AppText>
      </View>
      <ChevronRightIcon color={theme.mutedForeground} size={15} />
    </Pressable>
  )
})

function ItemKindIcon({ kind, color }: { kind: LibraryItem['kind']; color: string }) {
  if (kind === 'media') return <ImageIcon color={color} size={17} />
  if (kind === 'page') return <GlobeIcon color={color} size={17} />
  return <FileTextIcon color={color} size={17} />
}
