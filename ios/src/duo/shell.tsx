/** Adaptive iPhone / iPhone Duo shell (foundation PR):
 *  - Continuous state across fold/unfold (active tab, selected bot, sidebar toggle, inspector slot, scroll nav).
 *  - 84 pt Duo trailing side strip on folded & unfolded landscape; floating hide-on-scroll 3-tab bar on Standard iPhone
 *    and Duo Unfolded Portrait (never minimizing on unfolded portrait).
 *  - Left-edge back gesture on Standard iPhone with automatic visible Back fallback; native rail Back on Folded Duo.
 *  - Keeps existing Roster, ChatScreen and SettingsScreen wired without screen redesigns yet. */
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { type NativeScrollEvent, type NativeSyntheticEvent, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Roster } from '../bots/roster'
import { useBotStore } from '../bots/store'
import { ChatScreen } from '../chat/screen'
import { SettingsScreen } from '../settings/screen'
import { EdgeBackContainer } from '../ui/gestures/edge-back'
import { GlassOrb } from '../ui/glass'
import { CloseIcon, SidebarToggleIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { computeShellLayout, railSlots, type RootTab } from './layout'
import { INITIAL_SCROLL_NAV, type ScrollNavState, stepScrollNav } from './scroll-nav'
import { DuoSideStrip } from './side-strip'
import { FloatingTabBar } from './tab-bar'
import { useLiveSurface } from './use-surface'

export interface DuoShellProps {
  onOpenSettings?: () => void
  workBadgeCount?: number
  renderWork?: () => ReactNode
  renderInspector?: (close: () => void) => ReactNode
}

export function DuoShell({ onOpenSettings, workBadgeCount = 0, renderWork, renderInspector }: DuoShellProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { surface, metrics, keyboardVisible, assistiveAccess } = useLiveSurface()
  const bots = useBotStore(state => state.bots)
  const sections = useBotStore(state => state.sections)

  const [activeTab, setActiveTab] = useState<RootTab>('bots')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [scrollNav, setScrollNav] = useState<ScrollNavState>(INITIAL_SCROLL_NAV)

  const selected = bots.find(bot => bot.id === selectedId) ?? null
  const didAutoSelect = useRef(false)
  useEffect(() => {
    if (didAutoSelect.current || bots.length === 0) return
    didAutoSelect.current = true
    setSelectedId((bots.find(bot => bot.isPrimary) ?? bots[0]).id)
  }, [bots])

  const layout = computeShellLayout(surface, metrics, { inspectorOpen, sidebarOpen, assistiveAccess })
  const inDetail = !layout.splitMode && activeTab === 'bots' && selected !== null
  const slots = railSlots(surface, { tab: activeTab, inDetail, hasSelectedBot: selected !== null, keyboardVisible })

  const handleBack = useCallback(() => {
    if (inspectorOpen) {
      setInspectorOpen(false)
      return
    }
    if (selectedId) setSelectedId(null)
  }, [inspectorOpen, selectedId])

  const handleSelectTab = useCallback((tab: RootTab) => {
    setActiveTab(tab)
    setScrollNav(INITIAL_SCROLL_NAV)
    if (tab !== 'bots') setInspectorOpen(false)
  }, [])

  const handleRootScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent
      setScrollNav(prev =>
        stepScrollNav(prev, {
          y: contentOffset.y,
          contentHeight: contentSize.height,
          viewportHeight: layoutMeasurement.height,
          allowMinimize: layout.allowHeaderMinimize
        })
      )
    },
    [layout.allowHeaderMinimize]
  )

  const topPad = layout.hasSideStrip ? 0 : insets.top
  const bottomPad = insets.bottom
  const floatingBarInset = !layout.hasSideStrip && !inDetail ? 68 : 0

  const renderPrimaryContent = () => {
    if (activeTab === 'work') return renderWork ? renderWork() : <WorkPlaceholder />
    if (activeTab === 'settings') return <SettingsScreen onDone={() => setActiveTab('bots')} />
    if (layout.splitMode) {
      return (
        <View style={{ flex: 1, flexDirection: 'row' }}>
          {layout.rosterWidth > 0 && (
            <View style={{ width: layout.rosterWidth, borderRightWidth: 1, borderRightColor: theme.hairline }}>
              <Roster bots={bots} sections={sections} selectedId={selected?.id ?? null} onSelect={bot => setSelectedId(bot.id)} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            {layout.showSidebarToggle && (
              <View style={{ position: 'absolute', top: 8, left: 12, zIndex: 10 }}>
                <GlassOrb
                  size={36}
                  accessibilityLabel={sidebarOpen ? 'Hide bots sidebar' : 'Show bots sidebar'}
                  onPress={() => {
                    setInspectorOpen(false)
                    setSidebarOpen(open => !open)
                  }}
                  testID="duo-sidebar-toggle"
                >
                  <SidebarToggleIcon color={theme.foreground} />
                </GlassOrb>
              </View>
            )}
            {selected ? <ChatScreen bot={selected} /> : <EmptyDetail />}
          </View>
          {layout.inspectorWidth > 0 && renderInspector && (
            <View style={{ width: layout.inspectorWidth, borderLeftWidth: 1, borderLeftColor: theme.hairline }}>
              <View style={{ position: 'absolute', top: 8, right: 12, zIndex: 10 }}>
                <GlassOrb size={36} accessibilityLabel="Close inspector" onPress={() => setInspectorOpen(false)} testID="duo-inspector-close">
                  <CloseIcon color={theme.foreground} />
                </GlassOrb>
              </View>
              {renderInspector(() => setInspectorOpen(false))}
            </View>
          )}
        </View>
      )
    }

    if (selected) {
      return (
        <EdgeBackContainer surface={surface} canGoBack showVisibleBack={layout.requireVisibleBack} onBack={handleBack}>
          <ChatScreen bot={selected} />
        </EdgeBackContainer>
      )
    }
    return <Roster bots={bots} sections={sections} selectedId={null} onSelect={bot => setSelectedId(bot.id)} onScroll={handleRootScroll} bottomInset={floatingBarInset} />
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.background, paddingTop: topPad, paddingBottom: bottomPad }}>
      <View style={{ flex: 1 }}>
        {renderPrimaryContent()}
        {!layout.hasSideStrip && !inDetail && (
          <FloatingTabBar
            activeTab={activeTab}
            minimized={layout.allowHeaderMinimize && scrollNav.minimized}
            workBadgeCount={workBadgeCount}
            onSelectTab={handleSelectTab}
            onRestore={() => setScrollNav(INITIAL_SCROLL_NAV)}
          />
        )}
      </View>
      {layout.hasSideStrip && (
        <DuoSideStrip
          width={layout.railWidth}
          slots={slots}
          activeTab={activeTab}
          workBadgeCount={workBadgeCount}
          onSelectTab={handleSelectTab}
          onBack={inDetail || inspectorOpen ? handleBack : undefined}
        />
      )}
    </View>
  )
}

function EmptyDetail() {
  const theme = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <AppText variant="chat" color={theme.mutedForeground}>
        Pick a bot to start chatting.
      </AppText>
    </View>
  )
}

function WorkPlaceholder() {
  const theme = useTheme()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <AppText variant="title" color={theme.foreground}>
        Work
      </AppText>
    </View>
  )
}
