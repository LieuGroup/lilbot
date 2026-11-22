/** The Duo adaptive shell: unfolded (wide) shows the roster beside the conversation, folded
 *  (narrow) shows one at a time with a back button. The breakpoint is the window width. */
import { useState } from 'react'
import { Pressable, useWindowDimensions, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { useBotStore } from '../bots/store'
import { Roster } from '../bots/roster'
import { ChatScreen } from '../chat/screen'
import { useTheme } from '../ui/theme'
import { AppText } from '../ui/text'

/** At or above this width the app shows both panes (the unfolded Duo's 951pt canvas). */
const WIDE = 700

export function DuoShell({ onOpenSettings }: { onOpenSettings: () => void }) {
  const theme = useTheme()
  const { width } = useWindowDimensions()
  const wide = width >= WIDE
  const bots = useBotStore(state => state.bots)
  const sections = useBotStore(state => state.sections)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = bots.find(bot => bot.id === selectedId) ?? null

  if (!wide) {
    if (!selected) {
      return (
        <View style={{ flex: 1, backgroundColor: theme.background }}>
          <Roster bots={bots} sections={sections} selectedId={null} onSelect={bot => setSelectedId(bot.id)} onOpenSettings={onOpenSettings} />
        </View>
      )
    }
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <Pressable onPress={() => setSelectedId(null)} accessibilityLabel="Back" style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
          <AppText variant="name" color={theme.primary}>
            ‹ Bots
          </AppText>
        </Pressable>
        <ChatScreen bot={selected} />
      </View>
    )
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.background }}>
      <View style={{ width: 300, borderRightWidth: 1, borderRightColor: theme.hairline }}>
        <Roster bots={bots} sections={sections} selectedId={selected?.id ?? null} onSelect={bot => setSelectedId(bot.id)} onOpenSettings={onOpenSettings} />
      </View>
      <View style={{ flex: 1 }}>{selected ? <ChatScreen bot={selected} /> : <EmptyDetail theme={theme} />}</View>
    </View>
  )
}

function EmptyDetail({ theme }: { theme: ReturnType<typeof useTheme> }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <AppText variant="title" color={theme.mutedForeground}>
        LilBot
      </AppText>
      <AppText variant="chat" color={theme.mutedForeground}>
        Pick a bot to start chatting.
      </AppText>
    </View>
  )
}
