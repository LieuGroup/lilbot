/** Floating Regular Liquid Glass bottom 3-tab capsule for Standard iPhone and Duo Unfolded Portrait (R4-03a, R3-01b).
 *  Minimizes on downward scroll while keeping the blue Work alert pill visible whenever items wait on the user. */
import { Pressable, View } from 'react-native'
import { GlassOrb, GlassPill } from '../ui/glass'
import { BotsTabIcon, PlusIcon, SettingsTabIcon, WorkTabIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { GLASS_METRICS, radius } from '../ui/tokens'
import type { RootTab } from './layout'
import { showWorkAlertPill } from './scroll-nav'

export interface FloatingTabBarProps {
  activeTab: RootTab
  minimized: boolean
  workBadgeCount: number
  onSelectTab: (tab: RootTab) => void
  onRestore: () => void
  onNewBot?: () => void
}

export function FloatingTabBar({ activeTab, minimized, workBadgeCount, onSelectTab, onRestore, onNewBot }: FloatingTabBarProps) {
  const theme = useTheme()

  if (minimized) {
    const showAlert = showWorkAlertPill(minimized, workBadgeCount)
    return (
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <GlassOrb accessibilityLabel={`Restore navigation (${activeTab})`} onPress={onRestore} testID="tab-bar-minimized">
          <ActiveTabGlyph tab={activeTab} color={theme.foreground} />
        </GlassOrb>
        {showAlert && (
          <Pressable
            onPress={() => {
              onRestore()
              onSelectTab('work')
            }}
            accessibilityRole="button"
            accessibilityLabel={`Work, ${workBadgeCount} need you`}
            testID="tab-bar-work-alert"
          >
            <GlassPill height={GLASS_METRICS.tabBarHeight} style={{ paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.primary }} />
              <AppText variant="name">{workBadgeCount}</AppText>
            </GlassPill>
          </Pressable>
        )}
      </View>
    )
  }

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 16, right: 16, bottom: 12, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <GlassPill height={GLASS_METRICS.tabBarHeight} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', padding: 3 }}>
        <TabCell label="Bots" active={activeTab === 'bots'} onPress={() => onSelectTab('bots')} testID="tab-bots">
          <BotsTabIcon color={activeTab === 'bots' ? theme.foreground : theme.mutedForeground} />
        </TabCell>
        <TabCell
          label={workBadgeCount > 0 ? `Work, ${workBadgeCount} need you` : 'Work'}
          active={activeTab === 'work'}
          badge={workBadgeCount}
          onPress={() => onSelectTab('work')}
          testID="tab-work"
        >
          <WorkTabIcon color={activeTab === 'work' ? theme.foreground : theme.mutedForeground} />
        </TabCell>
        <TabCell label="Settings" active={activeTab === 'settings'} onPress={() => onSelectTab('settings')} testID="tab-settings">
          <SettingsTabIcon color={activeTab === 'settings' ? theme.foreground : theme.mutedForeground} />
        </TabCell>
      </GlassPill>
      {activeTab === 'bots' && (
        <GlassOrb accessibilityLabel="New bot" onPress={onNewBot} disabled={!onNewBot} testID="tab-new-bot">
          <PlusIcon color={theme.foreground} />
        </GlassOrb>
      )}
    </View>
  )
}

function ActiveTabGlyph({ tab, color }: { tab: RootTab; color: string }) {
  if (tab === 'work') return <WorkTabIcon color={color} />
  if (tab === 'settings') return <SettingsTabIcon color={color} />
  return <BotsTabIcon color={color} />
}

function TabCell({
  label,
  active,
  badge = 0,
  onPress,
  testID,
  children
}: {
  label: string
  active: boolean
  badge?: number
  onPress: () => void
  testID: string
  children: React.ReactNode
}) {
  const theme = useTheme()
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={{
        flex: 1,
        height: 38,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? theme.glass.activePill : 'transparent'
      }}
    >
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        {children}
        {badge > 0 && (
          <View
            style={{
              position: 'absolute',
              top: -6,
              right: -12,
              minWidth: 16,
              height: 16,
              borderRadius: 8,
              paddingHorizontal: 4,
              backgroundColor: theme.primary,
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <AppText variant="meta" color={theme.primaryForeground} style={{ fontSize: 10, lineHeight: 12, fontFamily: 'Inter_600SemiBold' }}>
              {badge > 99 ? '99+' : String(badge)}
            </AppText>
          </View>
        )}
      </View>
    </Pressable>
  )
}
