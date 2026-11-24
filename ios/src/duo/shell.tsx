/** Adaptive iPhone / iPhone Duo Bots root screen inside Expo Router's native Stack & NativeTabs.
 *  Compact surfaces show Roster and push `/chat`; split surfaces show Roster + Chat side by side.
 *  On iOS 27.1+ Duo Unfolded Landscape, hides ChatScreen's header and puts bot avatar + controls in the 84 pt strip. */
import { Stack, useFocusEffect, useIsFocused, useRouter } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../../shared/bot-schema'
import { Roster } from '../bots/roster'
import { useBotStore } from '../bots/store'
import { ChatScreen } from '../chat/screen'
import { useChatStore } from '../chat/store'
import { startNewChat } from '../chat/use-chat'
import { CloseIcon, SidebarToggleIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { DuoBotSheet } from './bot-sheet'
import { computeShellLayout, nextSidebarState } from './layout'
import { useBotSelection } from './selection'
import { indexStackAction, shouldPushOnBotSelect } from './stack-sync'
import { DuoStripAvatar } from './strip-avatar'
import { useLiveSurface, useVerticalBarEdge } from './use-surface'
import { buildDuoVerticalBarItems, duoVerticalHeaderOptions, isDuoVerticalBarActive, resolveDuoStripScreen, shouldHideDuoChatHeader, shouldShowInlineSidebarToggle } from './vertical-bar'

export interface DuoShellProps {
  renderInspector?: (close: () => void) => ReactNode
}

export function DuoShell({ renderInspector }: DuoShellProps) {
  const theme = useTheme()
  const router = useRouter()
  const isFocused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { surface, metrics } = useLiveSurface()
  const verticalBarEdge = useVerticalBarEdge()
  const bots = useBotStore(state => state.bots)
  const sections = useBotStore(state => state.sections)
  const selectedId = useBotSelection(state => state.selectedId)
  const pendingInitialPush = useBotSelection(state => state.pendingInitialPush)
  const select = useBotSelection(state => state.select)
  const clearPendingInitialPush = useBotSelection(state => state.clearPendingInitialPush)
  const autoSelectOnce = useBotSelection(state => state.autoSelectOnce)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)

  const selected = bots.find(bot => bot.id === selectedId) ?? null
  const selectedSlotRunning = useChatStore(state => (selected ? (state.slots[selected.id]?.view.running ?? false) : false))
  const selectedSlotReady = useChatStore(state => (selected ? (state.slots[selected.id]?.ready ?? false) : false))
  const selectedRunning = Boolean(selectedSlotRunning || selected?.activity?.status === 'working')
  const selectedUnread = Boolean(selected?.activity?.unread)
  const layout = computeShellLayout(surface, metrics, { inspectorOpen: inspectorOpen && !!renderInspector, sidebarOpen })
  const lastFocusedSplitMode = useRef(layout.splitMode)
  const pushPendingRef = useRef(false)

  useFocusEffect(
    useCallback(() => {
      pushPendingRef.current = false
      return () => setSheetOpen(false)
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

  const openSheet = useCallback(() => setSheetOpen(true), [])
  const closeSheet = useCallback(() => setSheetOpen(false), [])
  const handleNewSession = useCallback(() => {
    if (selected) void startNewChat(selected.id)
  }, [selected])

  const showRoster = !layout.splitMode || layout.rosterWidth > 0
  const verticalBarActive = isDuoVerticalBarActive({ surface, verticalBarEdge })
  const hideDuoChatHeader = shouldHideDuoChatHeader({ surface, verticalBarEdge, hasBot: selected !== null })
  const stripScreen = resolveDuoStripScreen({ surface, chatFocused: false })
  const sidebarLabel = showRoster ? 'Hide bots sidebar' : 'Show bots sidebar'
  const verticalBarItems = useMemo(() => {
    if (!verticalBarActive || !layout.splitMode) return []
    return buildDuoVerticalBarItems({
      screen: stripScreen,
      actions: {
        ...(selected
          ? {
              'bot-avatar': { element: <DuoStripAvatar bot={selected} running={selectedRunning} unread={selectedUnread} onPress={openSheet} />, hidesSharedBackground: false },
              'bot-menu': { label: `More for ${selected.name}`, onPress: openSheet }
            }
          : {}),
        ...(layout.showSidebarToggle ? { 'sidebar-toggle': { label: sidebarLabel, onPress: handleToggleSidebar } } : {})
      },
      tintColor: theme.foreground
    })
  }, [handleToggleSidebar, layout.showSidebarToggle, layout.splitMode, openSheet, selected, selectedRunning, selectedUnread, sidebarLabel, stripScreen, theme.foreground, verticalBarActive])

  const useNativeStripHeader = verticalBarActive && verticalBarItems.length > 0
  const stackOptions = useMemo(() => duoVerticalHeaderOptions(verticalBarItems, theme.foreground), [theme.foreground, verticalBarItems])
  const sidebarToggle = shouldShowInlineSidebarToggle({ showSidebarToggle: layout.showSidebarToggle, verticalBarActive }) ? (
    <Pressable onPress={handleToggleSidebar} hitSlop={8} accessibilityRole="button" accessibilityLabel={sidebarLabel} testID="duo-sidebar-toggle" style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}>
      <SidebarToggleIcon color={theme.foreground} />
    </Pressable>
  ) : undefined

  const rosterStyle = layout.splitMode
    ? { width: layout.rosterWidth, display: (showRoster ? 'flex' : 'none') as 'flex' | 'none', borderRightWidth: 1, borderRightColor: theme.hairline }
    : { flex: 1 }

  return (
    <>
      <Stack.Screen options={stackOptions} />
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.background, paddingTop: useNativeStripHeader ? 0 : insets.top, paddingLeft: layout.horizontalPadding.left, paddingRight: layout.horizontalPadding.right }}>
        <View key="roster-pane" style={rosterStyle}>
          <Roster bots={bots} sections={sections} selectedId={layout.splitMode ? (selected?.id ?? null) : null} onSelect={handleSelectBot} />
        </View>
        {layout.splitMode && (
          <View key="chat-pane" style={{ flex: 1 }}>
            {selected ? (
              <ChatScreen bot={selected} hideHeader={hideDuoChatHeader} headerLeading={sidebarToggle} />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                <AppText variant="chat" color={theme.mutedForeground}>
                  Pick a bot to start chatting.
                </AppText>
              </View>
            )}
          </View>
        )}
        {layout.splitMode && layout.inspectorWidth > 0 && renderInspector && (
          <View key="inspector-pane" style={{ width: layout.inspectorWidth, borderLeftWidth: 1, borderLeftColor: theme.hairline }}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 12, paddingTop: 8 }}>
              <Pressable onPress={() => setInspectorOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close inspector" testID="duo-inspector-close" style={{ width: 28, height: 28, alignItems: 'center', justifyContent: 'center' }}>
                <CloseIcon color={theme.foreground} />
              </Pressable>
            </View>
            {renderInspector(() => setInspectorOpen(false))}
          </View>
        )}
      </View>
      <DuoBotSheet bot={selected} visible={sheetOpen} running={selectedRunning} canStartNewSession={selectedSlotReady} onClose={closeSheet} onNewSession={handleNewSession} />
    </>
  )
}
