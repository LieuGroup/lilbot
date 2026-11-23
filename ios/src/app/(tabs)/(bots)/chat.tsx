/** Compact Chat pushed as the second native Stack screen inside the Bots tab.
 *  - Standard iPhone (`phone`): hides the Back button at rest (`headerBackVisible: false`) so UIKit's native
 *    left-edge swipe back (`gestureEnabled: true`) replaces it, restoring Back for VoiceOver and letting
 *    UIKit handle Assistive Access natively.
 *  - Folded Duo (`duo-folded`): keeps `headerBackVisible: true` so UIKit places native Back in the 84 pt rail.
 *  - Native `headerTitle` renders the bot avatar, name, and live "Working" label (matching main).
 *  - Unfolding pops back to the split screen without clearing selection or dropping the live chat session. */
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useRef } from 'react'
import { View } from 'react-native'
import type { Bot } from '../../../../../shared/bot-schema'
import { useBotStore } from '../../../bots/store'
import { ChatScreen } from '../../../chat/screen'
import { useChatStore } from '../../../chat/store'
import { computeShellLayout } from '../../../duo/layout'
import { useBotSelection } from '../../../duo/selection'
import { chatStackAction, shouldClearSelectionOnChatPop, shouldShowNativeBack } from '../../../duo/stack-sync'
import { useLiveSurface, useScreenReaderEnabled } from '../../../duo/use-surface'
import { BotAvatar } from '../../../ui/avatar'
import { AppText } from '../../../ui/text'
import { useTheme } from '../../../ui/theme'

export default function CompactChatRoute() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ botId?: string }>()
  const { surface, metrics } = useLiveSurface()
  const screenReaderEnabled = useScreenReaderEnabled()
  const bots = useBotStore(state => state.bots)
  const selectedId = useBotSelection(state => state.selectedId)
  const enterChat = useBotSelection(state => state.enterChat)
  const leaveChat = useBotSelection(state => state.leaveChat)
  const setChatFocused = useBotSelection(state => state.setChatFocused)
  const clearIfSelected = useBotSelection(state => state.clearIfSelected)

  const botId = (typeof params.botId === 'string' && params.botId) || selectedId || ''
  const bot = bots.find(candidate => candidate.id === botId) ?? null
  const running = useChatStore(state => (botId ? (state.slots[botId]?.view.running ?? false) : false))
  const layout = computeShellLayout(surface, metrics)

  const splitModeRef = useRef(layout.splitMode)
  splitModeRef.current = layout.splitMode
  const botIdRef = useRef(botId)
  botIdRef.current = botId
  const poppedRef = useRef(false)

  useEffect(() => {
    enterChat()
    return () => {
      leaveChat()
      setChatFocused(false)
      if (botIdRef.current && shouldClearSelectionOnChatPop(splitModeRef.current)) {
        clearIfSelected(botIdRef.current)
      }
    }
  }, [clearIfSelected, enterChat, leaveChat, setChatFocused])

  useFocusEffect(
    useCallback(() => {
      setChatFocused(true)
      return () => setChatFocused(false)
    }, [setChatFocused])
  )

  useEffect(() => {
    const hasBot = bots.length === 0 || bot !== null
    if (!poppedRef.current && chatStackAction({ splitMode: layout.splitMode, hasBot }) === 'pop-chat') {
      poppedRef.current = true
      router.back()
    }
  }, [bot, bots.length, layout.splitMode, router])

  const backVisible = shouldShowNativeBack(surface, screenReaderEnabled)

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: bot?.name ?? 'Chat',
          headerTitle: bot ? () => <ChatHeaderTitle bot={bot} running={running} /> : undefined,
          gestureEnabled: true,
          headerBackVisible: backVisible,
          headerBackButtonDisplayMode: 'minimal',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.foreground
        }}
      />
      <View style={{ flex: 1, backgroundColor: theme.background }}>{bot ? <ChatScreen bot={bot} hideHeader /> : null}</View>
    </>
  )
}

function ChatHeaderTitle({ bot, running }: { bot: Bot; running: boolean }) {
  const theme = useTheme()
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, maxWidth: 240 }}>
      <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={24} />
      <AppText variant="title" numberOfLines={1} style={{ flexShrink: 1 }}>
        {bot.name}
      </AppText>
      {running && (
        <AppText variant="meta" color={theme.primary} numberOfLines={1}>
          Working
        </AppText>
      )}
    </View>
  )
}
