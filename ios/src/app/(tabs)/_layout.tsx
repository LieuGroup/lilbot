/** Native iOS tab bar (Expo Router NativeTabs): UIKit draws Liquid Glass on iPhone,
 *  places tabs in the Duo 84 pt side strip, and pins minimizeBehavior to `never` on Duo Unfolded Portrait.
 *  Only live working tabs are registered (Work arrives in PR 6). */
import { NativeTabs } from 'expo-router/native-tabs'
import { computeShellLayout } from '../../duo/layout'
import { useLiveSurface } from '../../duo/use-surface'
import { useTheme } from '../../ui/theme'

export default function TabsLayout() {
  const theme = useTheme()
  const { surface, metrics } = useLiveSurface()
  const layout = computeShellLayout(surface, metrics)

  return (
    <NativeTabs
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
