/** Adaptive iPhone / iPhone Duo Bots root screen inside Expo Router's native Stack & NativeTabs.
 *  - Compact surfaces (Standard iPhone, Folded Duo, Duo Unfolded Portrait): renders the Roster and pushes
 *    `/chat` as a second native Stack screen so UIKit runs its own left-edge swipe back and Assistive Access Back.
 *  - Split surfaces (Duo Unfolded Landscape, iPad): renders Roster and Chat side by side with inline sidebar toggle.
 *  - Syncs stack transitions only while focused so folding/unfolding or initial load on Settings never hijacks tabs. */
import { useFocusEffect, useIsFocused, useRouter } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../../shared/bot-schema'
import { BotMenuHost } from '../bots/bot-menu-sheet'
import { Roster } from '../bots/roster'
import { useBotStore } from '../bots/store'
import { ChatScreen } from '../chat/screen'
import { CloseIcon, SidebarToggleIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { computeShellLayout, nextSidebarState } from './layout'
import { useBotSelection } from './selection'
import { indexStackAction, shouldPushOnBotSelect } from './stack-sync'
import { useLiveSurface } from './use-surface'

export interface DuoShellProps {
  renderInspector?: (close: () => void) => ReactNode
}

export function DuoShell({ renderInspector }: DuoShellProps) {
  const theme = useTheme()
  const router = useRouter()
  const isFocused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { surface, metrics } = useLiveSurface()
  const bots = useBotStore(state => state.bots)
  const sections = useBotStore(state => state.sections)
  const loaded = useBotStore(state => state.loaded)
  const connected = useBotStore(state => state.connected)
  const error = useBotStore(state => state.error)
  const selectedId = useBotSelection(state => state.selectedId)
  const pendingInitialPush = useBotSelection(state => state.pendingInitialPush)
  const select = useBotSelection(state => state.select)
  const clearPendingInitialPush = useBotSelection(state => state.clearPendingInitialPush)
  const autoSelectOnce = useBotSelection(state => state.autoSelectOnce)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  const selected = bots.find(bot => bot.id === selectedId) ?? null
  const layout = computeShellLayout(surface, metrics, { inspectorOpen: inspectorOpen && !!renderInspector, sidebarOpen })
  const lastFocusedSplitMode = useRef(layout.splitMode)
  const pushPendingRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      pushPendingRef.current = false
    }, [])
  )

  useEffect(() => {
    const activeId = autoSelectOnce(bots) ?? selectedId
    if (!isFocused) return
    const prevSplitMode = lastFocusedSplitMode.current
    lastFocusedSplitMode.current = layout.splitMode
    if (layout.splitMode) {
      pushPendingRef.current = false
      if (pendingInitialPush) clearPendingInitialPush()
      return
    }
    const state = useBotSelection.getState()
    const action = indexStackAction({
      focused: isFocused,
      splitMode: layout.splitMode,
      wasSplitMode: prevSplitMode,
      selectedId: activeId,
      chatMounted: state.chatInstances > 0,
      pushPending: pushPendingRef.current,
      pendingInitialPush: state.pendingInitialPush
    })
    if (action === 'push-chat' && activeId) {
      pushPendingRef.current = true
      clearPendingInitialPush()
      router.push({ pathname: '/chat', params: { botId: activeId } })
    }
  }, [autoSelectOnce, bots, clearPendingInitialPush, isFocused, layout.splitMode, pendingInitialPush, router, selectedId])

  const handleSelectBot = useCallback(
    (bot: Bot) => {
      select(bot.id)
      const chatMounted = useBotSelection.getState().chatInstances > 0
      if (shouldPushOnBotSelect({ splitMode: layout.splitMode, chatMounted, pushPending: pushPendingRef.current })) {
        pushPendingRef.current = true
        router.push({ pathname: '/chat', params: { botId: bot.id } })
      }
    },
    [layout.splitMode, router, select]
  )

  const handleToggleSidebar = useCallback(() => {
    const next = nextSidebarState({ sidebarOpen, inspectorOpen })
    setSidebarOpen(next.sidebarOpen)
    setInspectorOpen(next.inspectorOpen)
  }, [sidebarOpen, inspectorOpen])

  const showRoster = !layout.splitMode || layout.rosterWidth > 0
  const sidebarToggle = layout.showSidebarToggle ? (
    <Pressable
      onPress={handleToggleSidebar}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={showRoster ? 'Hide bots sidebar' : 'Show bots sidebar'}
      testID="duo-sidebar-toggle"
      style={({ pressed }) => ({
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.65 : 1
      })}
    >
      <SidebarToggleIcon color={theme.foreground} />
    </Pressable>
  ) : undefined

  const rosterStyle = layout.splitMode
    ? { width: layout.rosterWidth, display: (showRoster ? 'flex' : 'none') as 'flex' | 'none', borderRightWidth: 1, borderRightColor: theme.hairline }
    : { flex: 1 }

  return (
    <View
      style={{
        flex: 1,
        flexDirection: 'row',
        backgroundColor: theme.background,
        paddingTop: insets.top,
        paddingLeft: layout.horizontalPadding.left,
        paddingRight: layout.horizontalPadding.right
      }}
    >
      <View key="roster-pane" style={rosterStyle}>
        <Roster
          bots={bots}
          sections={sections}
          loaded={loaded}
          connected={connected}
          error={error}
          selectedId={layout.splitMode ? (selected?.id ?? null) : null}
          compactCardSurface={layout.splitMode || layout.hasSideStrip}
          splitMode={layout.splitMode}
          onSelect={handleSelectBot}
        />
      </View>
      <BotMenuHost />
      {layout.splitMode && (
        <View key="chat-pane" style={{ flex: 1 }}>
          {selected ? <ChatScreen bot={selected} headerLeading={sidebarToggle} /> : <EmptyDetail />}
        </View>
      )}
      {layout.splitMode && layout.inspectorWidth > 0 && renderInspector && (
        <View key="inspector-pane" style={{ width: layout.inspectorWidth, borderLeftWidth: 1, borderLeftColor: theme.hairline }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 }}>
            <Pressable
              onPress={() => setInspectorOpen(false)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Close inspector"
              testID="duo-inspector-close"
              style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}
            >
              <CloseIcon color={theme.foreground} />
            </Pressable>
          </View>
          {renderInspector(() => setInspectorOpen(false))}
        </View>
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
