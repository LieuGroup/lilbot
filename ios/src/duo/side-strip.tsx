/** The iPhone Duo 84 pt trailing side strip (R4-01a/b, R4-02a/b): 2-3 high-value glass actions + vertical 3-tab pill,
 *  typing-only bottom Dismiss Keyboard, and box-none gaps so edge scroll flicks pass through to the list/chat. */
import { Keyboard, Pressable, View } from 'react-native'
import { GlassOrb, GlassPill } from '../ui/glass'
import { BackIcon, BotsTabIcon, DismissKeyboardIcon, NewChatIcon, PlusIcon, SettingsTabIcon, WorkTabIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { GLASS_METRICS, radius } from '../ui/tokens'
import type { RailSlot, RootTab } from './layout'

export interface SideStripProps {
  width: number
  slots: RailSlot[]
  activeTab: RootTab
  workBadgeCount: number
  onSelectTab: (tab: RootTab) => void
  onBack?: () => void
  onNewBot?: () => void
  onNewChat?: () => void
}

export function DuoSideStrip({ width, slots, activeTab, workBadgeCount, onSelectTab, onBack, onNewBot, onNewChat }: SideStripProps) {
  const theme = useTheme()
  if (slots.length === 0) return null

  const topAction = slots.find(slot => slot === 'back' || slot === 'new-bot' || (slot === 'new-chat' && !slots.includes('back')))
  const middleAction = slots.includes('back') && slots.includes('new-chat') ? 'new-chat' : null
  const showTabs = slots.includes('tabs')
  const showDismissKeyboard = slots.includes('dismiss-keyboard')

  return (
    <View pointerEvents="box-none" style={{ width, borderLeftWidth: 1, borderLeftColor: theme.hairline, backgroundColor: theme.background, alignItems: 'center', paddingTop: 52, paddingBottom: 16 }}>
      <View pointerEvents="box-none" style={{ alignItems: 'center', gap: 16 }}>
        {topAction === 'back' && onBack && (
          <GlassOrb accessibilityLabel="Back" onPress={onBack} testID="duo-rail-back">
            <BackIcon color={theme.foreground} />
          </GlassOrb>
        )}
        {topAction === 'new-bot' && (
          <GlassOrb accessibilityLabel="New bot" onPress={onNewBot} disabled={!onNewBot} testID="duo-rail-new-bot">
            <PlusIcon color={theme.foreground} />
          </GlassOrb>
        )}
        {topAction === 'new-chat' && (
          <GlassOrb accessibilityLabel="New chat" onPress={onNewChat} disabled={!onNewChat} testID="duo-rail-new-chat">
            <NewChatIcon color={theme.foreground} />
          </GlassOrb>
        )}
      </View>

      <View pointerEvents="none" style={{ flex: 1 }} />

      {middleAction === 'new-chat' && (
        <View pointerEvents="box-none" style={{ marginBottom: 24 }}>
          <GlassOrb accessibilityLabel="New chat" onPress={onNewChat} disabled={!onNewChat} testID="duo-rail-new-chat">
            <NewChatIcon color={theme.foreground} />
          </GlassOrb>
        </View>
      )}

      {showTabs && !showDismissKeyboard && (
        <GlassPill height={GLASS_METRICS.railTabWidth * 3} style={{ width: GLASS_METRICS.railTabWidth, paddingVertical: 4, gap: 4, alignItems: 'center' }}>
          <RailTabButton label="Bots" active={activeTab === 'bots'} onPress={() => onSelectTab('bots')} testID="rail-tab-bots">
            <BotsTabIcon color={activeTab === 'bots' ? theme.foreground : theme.mutedForeground} />
          </RailTabButton>
          <RailTabButton
            label={workBadgeCount > 0 ? `Work, ${workBadgeCount} need you` : 'Work'}
            active={activeTab === 'work'}
            badge={workBadgeCount}
            onPress={() => onSelectTab('work')}
            testID="rail-tab-work"
          >
            <WorkTabIcon color={activeTab === 'work' ? theme.foreground : theme.mutedForeground} />
          </RailTabButton>
          <RailTabButton label="Settings" active={activeTab === 'settings'} onPress={() => onSelectTab('settings')} testID="rail-tab-settings">
            <SettingsTabIcon color={activeTab === 'settings' ? theme.foreground : theme.mutedForeground} />
          </RailTabButton>
        </GlassPill>
      )}

      {showDismissKeyboard && (
        <GlassOrb accessibilityLabel="Dismiss keyboard" onPress={() => Keyboard.dismiss()} testID="duo-rail-dismiss-keyboard">
          <DismissKeyboardIcon color={theme.foreground} />
        </GlassOrb>
      )}
    </View>
  )
}

function RailTabButton({
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
        width: 40,
        height: 44,
        borderRadius: radius.pill,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: active ? theme.glass.activePill : 'transparent'
      }}
    >
      {children}
      {badge > 0 && (
        <View
          style={{
            position: 'absolute',
            top: 4,
            right: 2,
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
    </Pressable>
  )
}
