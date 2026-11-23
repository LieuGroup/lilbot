/** Native iOS tab bar (Expo Router NativeTabs): UIKit draws Liquid Glass on iPhone,
 *  places tabs in the Duo 84 pt side strip, hides the bottom bar while focused in compact iPhone Chat,
 *  and pins minimizeBehavior to `never` on Duo Unfolded Portrait. Only live working tabs are registered. */
import { NativeTabs } from 'expo-router/native-tabs'
import { computeShellLayout } from '../../duo/layout'
import { useBotSelection } from '../../duo/selection'
import { shouldHideNativeTabBar } from '../../duo/stack-sync'
import { useLiveSurface } from '../../duo/use-surface'
import { useTheme } from '../../ui/theme'

export default function TabsLayout() {
  const theme = useTheme()
  const { surface, metrics } = useLiveSurface()
  const chatFocused = useBotSelection(state => state.chatFocused)
  const layout = computeShellLayout(surface, metrics)

  return (
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
    </NativeTabs>
  )
}
