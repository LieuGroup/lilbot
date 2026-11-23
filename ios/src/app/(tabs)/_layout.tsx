/** Native iOS tab bar (Expo Router NativeTabs): UIKit draws Liquid Glass on iPhone,
 *  places tabs in the Duo 84 pt side strip, renders the detached native orb via `role="search"`
 *  with native selection prevented (`disabled`) — `+` (New bot) on compact phones/folded Duo and
 *  `square.and.pencil` (New chat) on unfolded Duo/iPad split — hides the bottom bar while focused
 *  in compact iPhone Chat, and pins minimizeBehavior to `never` on Duo Unfolded Portrait. */
import { NativeTabs } from 'expo-router/native-tabs'
import { useBotMenuStore } from '../../bots/menu-store'
import { NewBotSheet } from '../../bots/new-bot-sheet'
import { detachedTabTriggerSpec } from '../../bots/roster-state'
import { startNewChat } from '../../chat/use-chat'
import { computeShellLayout } from '../../duo/layout'
import { useBotSelection } from '../../duo/selection'
import { shouldHideNativeTabBar } from '../../duo/stack-sync'
import { useLiveSurface } from '../../duo/use-surface'
import { useTheme } from '../../ui/theme'

export default function TabsLayout() {
  const theme = useTheme()
  const { surface, metrics } = useLiveSurface()
  const chatFocused = useBotSelection(state => state.chatFocusCount > 0)
  const selectedId = useBotSelection(state => state.selectedId)
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const layout = computeShellLayout(surface, metrics)
  const trigger = detachedTabTriggerSpec(layout.splitMode)

  const handleDetachedPress = () => {
    if (trigger.action === 'new-chat') {
      if (selectedId) startNewChat(selectedId)
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
    </>
  )
}
