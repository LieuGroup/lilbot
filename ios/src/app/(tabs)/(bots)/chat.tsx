/** Compact Chat pushed as the second native Stack screen inside the Bots tab.
 *  - Standard iPhone (`phone`): hides the Back button at rest (`headerBackVisible: false`) so UIKit's native
 *    left-edge swipe back (`gestureEnabled: true`) replaces it, restoring Back for VoiceOver.
 *  - Folded Duo (`duo-folded`, iOS 27.1+ vertical bar active): removes the horizontal Chat header completely
 *    so the conversation uses the full vertical height, placing the bot avatar (with working ring / unread dot)
 *    and native Back in the 84 pt vertical strip.
 *  - Unfolded Portrait (`duo-unfolded-portrait`), ordinary iPhone, and iOS < 27.1 keep `ChatHeaderTitle`. */
import { Stack, useFocusEffect, useIsFocused, useLocalSearchParams, useNavigation } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import type { Bot } from '../../../../../shared/bot-schema'
import { useBotStore } from '../../../bots/store'
import { ChatScreen } from '../../../chat/screen'
import { useChatStore } from '../../../chat/store'
import { startNewChat } from '../../../chat/use-chat'
import { DuoBotSheet } from '../../../duo/bot-sheet'
import { computeShellLayout } from '../../../duo/layout'
import { useBotSelection } from '../../../duo/selection'
import { chatStackAction, shouldClearSelectionOnChatPop, shouldShowNativeBack } from '../../../duo/stack-sync'
import { DuoStripAvatar } from '../../../duo/strip-avatar'
import { useLiveSurface, useScreenReaderEnabled, useVerticalBarEdge } from '../../../duo/use-surface'
import { buildDuoVerticalBarItems, duoVerticalHeaderOptions, resolveDuoStripScreen, shouldHideDuoChatHeader } from '../../../duo/vertical-bar'
import { BotAvatar } from '../../../ui/avatar'
import { AppText } from '../../../ui/text'
import { useTheme } from '../../../ui/theme'

export default function CompactChatRoute() {
  const theme = useTheme()
  const navigation = useNavigation()
  const isFocused = useIsFocused()
  const params = useLocalSearchParams<{ botId?: string }>()
  const { surface, metrics } = useLiveSurface()
  const verticalBarEdge = useVerticalBarEdge()
  const screenReaderEnabled = useScreenReaderEnabled()
  const bots = useBotStore(state => state.bots)
  const selectedId = useBotSelection(state => state.selectedId)
  const enterChat = useBotSelection(state => state.enterChat)
  const leaveChat = useBotSelection(state => state.leaveChat)
  const focusChat = useBotSelection(state => state.focusChat)
  const blurChat = useBotSelection(state => state.blurChat)
  const clearIfSelected = useBotSelection(state => state.clearIfSelected)
  const [sheetOpen, setSheetOpen] = useState(false)

  const botId = (typeof params.botId === 'string' && params.botId) || selectedId || ''
  const bot = bots.find(candidate => candidate.id === botId) ?? null
  const slotRunning = useChatStore(state => (botId ? (state.slots[botId]?.view.running ?? false) : false))
  const slotReady = useChatStore(state => (botId ? (state.slots[botId]?.ready ?? false) : false))
  const running = Boolean(slotRunning || bot?.activity?.status === 'working')
  const unread = Boolean(bot?.activity?.unread)
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
      if (botIdRef.current && shouldClearSelectionOnChatPop(splitModeRef.current)) {
        clearIfSelected(botIdRef.current)
      }
    }
  }, [clearIfSelected, enterChat, leaveChat])

  useFocusEffect(
    useCallback(() => {
      focusChat()
      return () => {
        blurChat()
        setSheetOpen(false)
      }
    }, [blurChat, focusChat])
  )

  useEffect(() => {
    const hasBot = bots.length === 0 || bot !== null
    const action = chatStackAction({ focused: isFocused, splitMode: layout.splitMode, hasBot })
    if (action !== 'pop-chat') {
      poppedRef.current = false
      return
    }
    if (!poppedRef.current && navigation.canGoBack()) {
      poppedRef.current = true
      navigation.goBack()
    }
  }, [bot, bots.length, isFocused, layout.splitMode, navigation])

  const openSheet = useCallback(() => setSheetOpen(true), [])
  const closeSheet = useCallback(() => setSheetOpen(false), [])
  const handleNewSession = useCallback(() => {
    if (botId) void startNewChat(botId)
  }, [botId])

  const backVisible = shouldShowNativeBack(surface, screenReaderEnabled)
  const hideDuoHeader = shouldHideDuoChatHeader({ surface, verticalBarEdge, hasBot: bot !== null })
  const stripScreen = resolveDuoStripScreen({ surface, chatFocused: true })
  const verticalBarItems = useMemo(
    () =>
      hideDuoHeader && bot
        ? buildDuoVerticalBarItems({
            screen: stripScreen,
            actions: {
              'bot-avatar': { element: <DuoStripAvatar bot={bot} running={running} unread={unread} onPress={openSheet} />, hidesSharedBackground: false },
              'bot-menu': { label: `More for ${bot.name}`, onPress: openSheet }
            },
            tintColor: theme.foreground
          })
        : [],
    [bot, hideDuoHeader, openSheet, running, stripScreen, theme.foreground, unread]
  )

  const screenOptions = useMemo(() => {
    if (hideDuoHeader && verticalBarItems.length > 0) {
      return {
        ...duoVerticalHeaderOptions(verticalBarItems, theme.foreground, { backVisible }),
        gestureEnabled: true
      }
    }
    return {
      headerShown: true,
      title: bot?.name ?? 'Chat',
      headerTitle: bot ? () => <ChatHeaderTitle bot={bot} running={running} /> : undefined,
      gestureEnabled: true,
      headerBackVisible: backVisible,
      headerBackButtonDisplayMode: 'minimal' as const,
      headerTransparent: false,
      headerShadowVisible: false,
      headerStyle: { backgroundColor: theme.background },
      headerTintColor: theme.foreground,
      unstable_headerRightItems: undefined
    }
  }, [backVisible, bot, hideDuoHeader, running, theme.background, theme.foreground, verticalBarItems])

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingLeft: layout.horizontalPadding.left,
          paddingRight: layout.horizontalPadding.right
        }}
      >
        {bot ? <ChatScreen bot={bot} hideHeader /> : null}
      </View>
      <DuoBotSheet bot={bot} visible={sheetOpen} running={running} canStartNewSession={slotReady} onClose={closeSheet} onNewSession={handleNewSession} />
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
