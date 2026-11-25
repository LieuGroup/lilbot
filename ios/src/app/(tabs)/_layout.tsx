/** Native iOS tab bar (Expo Router NativeTabs): UIKit draws Liquid Glass on iPhone,
 *  places tabs in the Duo 84 pt side strip, omits the 3rd detached trigger on iPad so the top
 *  tab capsule holds only `Bots | Settings` (New session lives in split Chat header), switches
 *  Folded Duo Chat's strip orb to `square.and.pencil` (New session) while keeping `+` (New bot)
 *  on compact Rosters, hides the bottom bar in compact iPhone Chat, and pins minimizeBehavior on
 *  Duo Unfolded Portrait. */
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
  const chatFocused = useBotSelection(state => state.chatFocusCount > 0)
  const selectedId = useBotSelection(state => state.selectedId)
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const closeBotOverlays = useBotMenuStore(state => state.closeBotOverlays)
  const layout = computeShellLayout(surface, metrics)
  const trigger = detachedTabTriggerSpec({ surface, chatFocused })
  const botsTabActive = isBotsTabSegments(segments)

  useEffect(() => {
    if (!botsTabActive) closeBotOverlays()
  }, [botsTabActive, closeBotOverlays])

  const handleDetachedPress = () => {
    if (!trigger) return
    if (trigger.action === 'new-session') {
      const liveReady = selectedId ? (useChatStore.getState().slots[selectedId]?.ready ?? false) : false
      const liveConnected = useConnectionStore.getState().connected
      if (selectedId && canStartNewSession({ connected: liveConnected, ready: liveReady, botsTabActive, selectedId })) {
        startNewChat(selectedId)
      }
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
        {trigger ? (
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
        ) : null}
      </NativeTabs>
      <NewBotSheet />
      <BotMenuHost />
    </>
  )
}
