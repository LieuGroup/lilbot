/** Native iOS tab bar (Expo Router NativeTabs): UIKit draws Liquid Glass on iPhone,
 *  places tabs in the Duo 84 pt side strip, renders the detached `+` New bot orb via `role="search"`
 *  with native selection prevented (`disabled`) so tapping opens New Bot without activating search or
 *  switching tabs on iPhone, iPad, or Duo, hides the bottom bar while focused in compact iPhone Chat,
 *  and pins minimizeBehavior to `never` on Duo Unfolded Portrait. Only live working tabs are registered. */
import { NativeTabs } from 'expo-router/native-tabs'
import { useBotMenuStore } from '../../bots/menu-store'
import { NewBotSheet } from '../../bots/new-bot-sheet'
import { NEW_BOT_TRIGGER_A11Y } from '../../bots/roster-state'
import { computeShellLayout } from '../../duo/layout'
import { useBotSelection } from '../../duo/selection'
import { shouldHideNativeTabBar } from '../../duo/stack-sync'
import { useLiveSurface } from '../../duo/use-surface'
import { useTheme } from '../../ui/theme'

export default function TabsLayout() {
  const theme = useTheme()
  const { surface, metrics } = useLiveSurface()
  const chatFocused = useBotSelection(state => state.chatFocusCount > 0)
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const layout = computeShellLayout(surface, metrics)

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
          testID={NEW_BOT_TRIGGER_A11Y.testID}
          accessibilityLabel={NEW_BOT_TRIGGER_A11Y.label}
          listeners={{
            tabPress: () => {
              openNewBot()
            }
          }}
        >
          <NativeTabs.Trigger.Icon sf="plus" />
          <NativeTabs.Trigger.Label>{NEW_BOT_TRIGGER_A11Y.label}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
      <NewBotSheet />
    </>
  )
}
