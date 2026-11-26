/** Rows of the Memory page inside grouped cards: a fact (wraps to two lines, the whole of it at the largest sizes),
 *  "Show N more", a bot with its count, a removed fact with Restore, and the removed-facts link under the lists. */
import { Pressable, useWindowDimensions, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { factCount, moreLine, removedLine, removedLink, rowNote } from '../../../shared/client/memory/memory-lines'
import type { MemoryBot, MemoryFact } from '../../../shared/memory-schema'
import { BotAvatar } from '../ui/avatar'
import { TrashIcon } from '../ui/details-icons'
import { DYNAMIC_TYPE_CAPS } from '../ui/dynamic-type'
import { ChevronDownIcon, ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'

const rowStyle = { minHeight: 48, paddingHorizontal: 14, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 10 } as const

/** Two lines at ordinary sizes; the whole text at accessibility sizes, so nothing is cut off. */
const useTextLines = () => (useWindowDimensions().fontScale >= 1.6 ? undefined : 2)

export function FactRow({ fact, now, bot, onOpen }: { fact: MemoryFact; now: number; bot?: Bot; onOpen: () => void }) {
  const theme = useTheme()
  const lines = useTextLines()
  const note = rowNote(fact, now)
  return (
    <Pressable
      testID={`memory-fact-${fact.id}`}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={note ? `${fact.text}, ${note}` : fact.text}
      style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.65 : 1 }]}
    >
      {bot ? <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={20} /> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <AppText variant="chat" numberOfLines={lines} color={note ? theme.mutedForeground : theme.foreground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          {fact.text}
        </AppText>
        {note ? (
          <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.meta}>
            {note}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  )
}

export function MoreRow({ hidden, label, onPress }: { hidden?: number; label?: string; onPress: () => void }) {
  const theme = useTheme()
  const text = label ?? moreLine(hidden ?? 0)
  return (
    <Pressable testID="memory-show-more" onPress={onPress} accessibilityRole="button" style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.65 : 1 }]}>
      <AppText variant="chat" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1 }]}>
        {text}
      </AppText>
      <ChevronDownIcon color={theme.mutedForeground} size={15} />
    </Pressable>
  )
}

/** "Known by one bot only": avatar, name ("Deleted" and no avatar for a deleted bot), "N facts" and a chevron. */
export function BotRow({ owner, bot, onOpen }: { owner: MemoryBot; bot?: Bot; onOpen: () => void }) {
  const theme = useTheme()
  const lines = useTextLines()
  const count = factCount(owner.facts)
  return (
    <Pressable
      testID={`memory-bot-${owner.botId}`}
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${owner.name}${owner.deleted ? ', Deleted' : ''}, ${count}`}
      style={({ pressed }) => [rowStyle, { opacity: pressed ? 0.65 : 1 }]}
    >
      {bot && !owner.deleted ? <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={24} /> : <View style={{ width: 24 }} />}
      <AppText variant="name" numberOfLines={lines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={[MOBILE_SCALE.details.rowTitle, { flex: 1, minWidth: 0 }]}>
        {owner.name}
        {owner.deleted ? (
          <AppText variant="meta" color={theme.mutedForeground} style={MOBILE_SCALE.details.meta}>
            {'  Deleted'}
          </AppText>
        ) : null}
      </AppText>
      <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowTime} style={MOBILE_SCALE.details.meta}>
        {count}
      </AppText>
      <ChevronRightIcon color={theme.mutedForeground} size={15} />
    </Pressable>
  )
}

/** A removed fact: its text (the whole of it once opened), who removed it and when, and Restore. */
export function RemovedRow({ fact, botName, open, busy, onToggle, onRestore }: { fact: MemoryFact; botName: string; open: boolean; busy: boolean; onToggle: () => void; onRestore: () => void }) {
  const theme = useTheme()
  const lines = useTextLines()
  const stack = useWindowDimensions().fontScale >= 1.6
  return (
    <View style={[rowStyle, { flexDirection: stack ? 'column' : 'row', alignItems: stack ? 'flex-start' : 'center' }]}>
      <Pressable testID={`memory-removed-${fact.id}`} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} style={{ flex: stack ? undefined : 1, minWidth: 0, gap: 2 }}>
        <AppText variant="chat" numberOfLines={open ? undefined : lines} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName} style={MOBILE_SCALE.details.rowTitle}>
          {fact.text}
        </AppText>
        <AppText variant="meta" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={MOBILE_SCALE.details.meta}>
          {removedLine(fact, botName)}
        </AppText>
      </Pressable>
      <Pressable
        testID={`memory-restore-${fact.id}`}
        disabled={busy}
        onPress={onRestore}
        accessibilityRole="button"
        accessibilityLabel={`Restore ${fact.text}`}
        style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, justifyContent: 'center', borderRadius: radius.md, borderWidth: 1, borderColor: theme.border, opacity: busy ? 0.5 : pressed ? 0.65 : 1 })}
      >
        <AppText variant="name" maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.control} style={MOBILE_SCALE.details.button}>
          Restore
        </AppText>
      </Pressable>
    </View>
  )
}

export function RemovedLink({ count, onOpen }: { count: number; onOpen: () => void }) {
  const theme = useTheme()
  return (
    <Pressable testID="memory-removed-link" onPress={onOpen} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 4, opacity: pressed ? 0.65 : 1 })}>
      <TrashIcon color={theme.mutedForeground} size={16} />
      <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview} style={[MOBILE_SCALE.details.rowSubtitle, { flex: 1 }]}>
        {removedLink(count)}
      </AppText>
      <ChevronRightIcon color={theme.mutedForeground} size={14} />
    </Pressable>
  )
}
