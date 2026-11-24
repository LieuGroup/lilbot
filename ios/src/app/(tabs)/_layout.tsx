/** Native iOS tab bar (Expo Router NativeTabs): UIKit draws Liquid Glass on iPhone,
 *  places tabs in the Duo 84 pt side strip, renders the detached native orb via `role="search"`
 *  with native selection prevented (`disabled`) — `+` (New bot) on compact phones/folded Duo and
 *  `square.and.pencil` (New session) on unfolded Duo/iPad split — hides the bottom bar while focused
 *  in compact iPhone Chat, and pins minimizeBehavior to `never` on Duo Unfolded Portrait. */
import { useSegments } from 'expo-router'
import { NativeTabs } from 'expo-router/native-tabs'
import { useEffect } from 'react'
import { BotMenuHost } from '../../bots/bot-menu-sheet'
import { useBotMenuStore } from '../../bots/menu-store'
import { NewBotSheet } from '../../bots/new-bot-sheet'
import { canStartNewSession, detachedTabTriggerSpec, isBotsTabSegments } from '../../bots/roster-state'
import { useChatStore } from '../../chat/store'
import { startNewChat } from '../../chat/use-chat'
import { useConnectionStore } from '../../connection/store'
import { computeShellLayout } from '../../duo/layout'
import { useBotSelection } from '../../duo/selection'
import { shouldHideNativeTabBar } from '../../duo/stack-sync'
import { useLiveSurface } from '../../duo/use-surface'
import { useTheme } from '../../ui/theme'

export default function TabsLayout() {
  const theme = useTheme()
  const segments = useSegments()
  const { surface, metrics } = useLiveSurface()
  const connected = useConnectionStore(state => state.connected)
  const chatFocused = useBotSelection(state => state.chatFocusCount > 0)
  const selectedId = useBotSelection(state => state.selectedId)
  const chatReady = useChatStore(state => (selectedId ? (state.slots[selectedId]?.ready ?? false) : false))
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const closeBotOverlays = useBotMenuStore(state => state.closeBotOverlays)
  const layout = computeShellLayout(surface, metrics)
  const trigger = detachedTabTriggerSpec(layout.splitMode)
  const botsTabActive = isBotsTabSegments(segments)
  const newSessionAllowed = canStartNewSession({
    connected,
    ready: chatReady,
    botsTabActive,
    selectedId
  })

  useEffect(() => {
    if (!botsTabActive) closeBotOverlays()
  }, [botsTabActive, closeBotOverlays])

  const handleDetachedPress = () => {
    if (trigger.action === 'new-session') {
      if (newSessionAllowed && selectedId) startNewChat(selectedId)
      return
    }
    openNewBot()
  }

  return (
    <>
      <NativeTabs
        hidden={shouldHideNativeTabBar(surface, chatFocused)}
        minimizeBehavior={layout.tabBarMinimizeBehavior}
        tintColor={theme.foreground}
        iconColor={{ default: theme.mutedForeground, selected: theme.foreground }}
      >
        <NativeTabs.Trigger name="(bots)">
          <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
          <NativeTabs.Trigger.Label>Bots</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="settings">
          <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
          <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger
          name="new-bot"
          role="search"
          disabled
          testID={trigger.testID}
          accessibilityLabel={trigger.label}
          listeners={{
            tabPress: handleDetachedPress
          }}
        >
          <NativeTabs.Trigger.Icon sf={trigger.sf} />
          <NativeTabs.Trigger.Label>{trigger.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      <NewBotSheet />
      <BotMenuHost />
    </>
  )
}
