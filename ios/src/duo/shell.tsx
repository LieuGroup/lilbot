/** Adaptive iPhone / iPhone Duo Bots root screen inside Expo Router's native Stack & NativeTabs.
 *  Compact surfaces show Roster and push `/chat`; split surfaces show Roster + Chat side by side.
 *  On iOS 27.1+ Duo, places Roster/Chat strip controls (and unfolded Chat's tappable bot avatar) in the 84 pt strip. */
import { Stack, useFocusEffect, useIsFocused, useRouter } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Keyboard, Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../../shared/bot-schema'
import { useBotMenuStore } from '../bots/menu-store'
import { Roster } from '../bots/roster'
import { closeRosterSearch, INITIAL_ROSTER_SEARCH_STATE, openRosterSearch, type RosterSearchState, setRosterSearchQuery, toggleRosterSearch } from '../bots/roster-list'
import { useBotStore } from '../bots/store'
import type { RenderToolItem } from '../chat/message-item'
import { ChatScreen } from '../chat/screen'
import { useChatStore } from '../chat/store'
import { useConnectionStore } from '../connection/store'
import { SidebarToggleIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { computeShellLayout, nextSidebarState } from './layout'
import { useBotSelection } from './selection'
import { indexStackAction, shouldPushOnBotSelect } from './stack-sync'
import { DuoStripAvatar } from './strip-avatar'
import { useLiveSurface, useVerticalBarEdge } from './use-surface'
import { buildDuoVerticalBarItems, duoVerticalHeaderOptions, isDuoVerticalBarActive, resolveDuoStripScreen, shouldHideDuoChatHeader, shouldShowInlineSidebarToggle } from './vertical-bar'

export interface DuoShellProps {
  inspectorOpen?: boolean
  onCloseInspector?: () => void
  renderInspector?: (close: () => void) => ReactNode
  renderChatDock?: (bot: Bot) => ReactNode
  renderChatToolItem?: (bot: Bot) => RenderToolItem
}

export function DuoShell({ inspectorOpen: inspectorOpenProp, onCloseInspector, renderInspector, renderChatDock, renderChatToolItem }: DuoShellProps) {
  const theme = useTheme()
  const router = useRouter()
  const isFocused = useIsFocused()
  const insets = useSafeAreaInsets()
  const { surface, metrics } = useLiveSurface()
  const verticalBarEdge = useVerticalBarEdge()
  const bots = useBotStore(state => state.bots)
  const sections = useBotStore(state => state.sections)
  const loaded = useBotStore(state => state.loaded)
  const error = useBotStore(state => state.error)
  const connected = useConnectionStore(state => state.connected)
  const openMenu = useBotMenuStore(state => state.openMenu)
  const openNewBot = useBotMenuStore(state => state.openNewBot)
  const selectedId = useBotSelection(state => state.selectedId)
  const pendingInitialPush = useBotSelection(state => state.pendingInitialPush)
  const select = useBotSelection(state => state.select)
  const clearPendingInitialPush = useBotSelection(state => state.clearPendingInitialPush)
  const autoSelectOnce = useBotSelection(state => state.autoSelectOnce)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [search, setSearch] = useState<RosterSearchState>(INITIAL_ROSTER_SEARCH_STATE)

  const selected = bots.find(bot => bot.id === selectedId) ?? null
  const selectedSlotRunning = useChatStore(state => (selected ? (state.slots[selected.id]?.view.running ?? false) : false))
  const selectedRunning = Boolean(selectedSlotRunning || selected?.activity?.status === 'working')
  const selectedUnread = Boolean(selected?.activity?.unread)
  const inspectorActive = (inspectorOpenProp ?? inspectorOpen) && !!renderInspector
  const layout = computeShellLayout(surface, metrics, { inspectorOpen: inspectorActive, sidebarOpen })
  const showRoster = !layout.splitMode || layout.rosterWidth > 0
  const lastFocusedSplitMode = useRef(layout.splitMode)
  const pushPendingRef = useRef(false)
  const prevSearchOpenRef = useRef(false)

  const openSearch = useCallback(() => setSearch(openRosterSearch), [])
  const closeSearch = useCallback(() => setSearch(closeRosterSearch), [])
  const toggleSearch = useCallback(() => setSearch(toggleRosterSearch), [])
  const changeSearchQuery = useCallback((query: string) => setSearch(prev => setRosterSearchQuery(prev, query)), [])

  useEffect(() => {
    if (prevSearchOpenRef.current && !search.open) Keyboard.dismiss()
    prevSearchOpenRef.current = search.open
  }, [search.open])

  useFocusEffect(useCallback(() => { pushPendingRef.current = false }, []))
  useEffect(() => { if (!isFocused || !showRoster) closeSearch() }, [closeSearch, isFocused, showRoster])

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
      closeSearch()
      select(bot.id)
      const chatMounted = useBotSelection.getState().chatInstances > 0
      if (shouldPushOnBotSelect({ splitMode: layout.splitMode, chatMounted, pushPending: pushPendingRef.current })) {
        pushPendingRef.current = true
        router.push({ pathname: '/chat', params: { botId: bot.id } })
      }
    },
    [closeSearch, layout.splitMode, router, select]
  )

  const closeInspector = useCallback(() => {
    setInspectorOpen(false)
    onCloseInspector?.()
  }, [onCloseInspector])

  const handleToggleSidebar = useCallback(() => {
    const next = nextSidebarState({ sidebarOpen, inspectorOpen: inspectorActive })
    setSidebarOpen(next.sidebarOpen)
    if (!next.inspectorOpen) closeInspector()
  }, [closeInspector, inspectorActive, sidebarOpen])

  const toggleInspector = useCallback(() => setInspectorOpen(open => !open), [])
  const openSelectedMenu = useCallback(() => { if (selected) openMenu(selected.id) }, [openMenu, selected])

  const verticalBarActive = isDuoVerticalBarActive({ surface, verticalBarEdge })
  const hideDuoChatHeader = shouldHideDuoChatHeader({ surface, verticalBarEdge, hasBot: selected !== null })
  const stripScreen = resolveDuoStripScreen({ surface, chatFocused: false })
  const sidebarLabel = showRoster ? 'Hide bots sidebar' : 'Show bots sidebar'
  const verticalBarItems = useMemo(() => {
    if (!verticalBarActive) return []
    return buildDuoVerticalBarItems({
      screen: stripScreen,
      actions: {
        ...(layout.splitMode && selected
          ? {
              'bot-avatar': {
                element: <DuoStripAvatar bot={selected} running={selectedRunning} unread={selectedUnread} onPress={renderInspector ? toggleInspector : openSelectedMenu} />,
                hidesSharedBackground: false
              },
              'bot-menu': { label: `More for ${selected.name}`, onPress: openSelectedMenu }
            }
          : {}),
        ...(layout.showSidebarToggle ? { 'sidebar-toggle': { label: sidebarLabel, onPress: handleToggleSidebar } } : {}),
        ...(layout.splitMode ? { 'new-bot': { onPress: openNewBot } } : {}),
        ...(showRoster ? { 'search-bots': { onPress: toggleSearch } } : {})
      },
      tintColor: theme.foreground
    })
  }, [handleToggleSidebar, layout.showSidebarToggle, layout.splitMode, openNewBot, openSelectedMenu, renderInspector, selected, selectedRunning, selectedUnread, showRoster, sidebarLabel, stripScreen, theme.foreground, toggleInspector, toggleSearch, verticalBarActive])

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
          <Roster bots={bots} sections={sections} loaded={loaded} connected={connected} error={error} selectedId={layout.splitMode ? (selected?.id ?? null) : null} splitMode={layout.splitMode} hideInlineSearch={verticalBarActive} hideInlineNewBot={verticalBarActive && layout.splitMode} searchOpen={search.open} searchQuery={search.query} onChangeSearchQuery={changeSearchQuery} onOpenSearch={openSearch} onCloseSearch={closeSearch} onSelect={handleSelectBot} />
        </View>
        {layout.splitMode && (
          <View key="chat-pane" style={{ flex: 1 }}>
            {selected ? (
              <ChatScreen bot={selected} hideHeader={hideDuoChatHeader} headerLeading={sidebarToggle} showNewSession={surface === 'pad'} onOpenDetails={renderInspector ? toggleInspector : undefined} dock={renderChatDock?.(selected)} renderToolItem={renderChatToolItem?.(selected)} />
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
            {renderInspector(closeInspector)}
          </View>
        )}
      </View>
    </>
  )
}
