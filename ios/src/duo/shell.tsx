/** Adaptive iPhone / iPhone Duo Bots root screen inside Expo Router's native Stack & NativeTabs.
 *  - Compact surfaces (Standard iPhone, Folded Duo, Duo Unfolded Portrait): renders the Roster and pushes
 *    `/chat` as a second native Stack screen so UIKit runs its own left-edge swipe back and Assistive Access Back.
 *  - Split surfaces (Duo Unfolded Landscape, iPad): renders Roster and Chat side by side with inline sidebar toggle.
 *  - Drafts, scroll offsets, and ref-counted live chat subscriptions live in the chat store/manager so fold and
 *    unfold transitions between split and pushed compact Chat stay seamless. */
import { useRouter } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { Bot } from '../../../shared/bot-schema'
import { Roster } from '../bots/roster'
import { useBotStore } from '../bots/store'
import { ChatScreen } from '../chat/screen'
import { CloseIcon, SidebarToggleIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { computeShellLayout, nextSidebarState } from './layout'
import { useBotSelection } from './selection'
import { indexStackAction } from './stack-sync'
import { useLiveSurface } from './use-surface'

export interface DuoShellProps {
  renderInspector?: (close: () => void) => ReactNode
}

export function DuoShell({ renderInspector }: DuoShellProps) {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { surface, metrics } = useLiveSurface()
  const bots = useBotStore(state => state.bots)
  const sections = useBotStore(state => state.sections)
  const selectedId = useBotSelection(state => state.selectedId)
  const select = useBotSelection(state => state.select)
  const autoSelectOnce = useBotSelection(state => state.autoSelectOnce)

  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  const selected = bots.find(bot => bot.id === selectedId) ?? null
  const layout = computeShellLayout(surface, metrics, { inspectorOpen: inspectorOpen && !!renderInspector, sidebarOpen })
  const wasSplitMode = useRef(layout.splitMode)

  useEffect(() => {
    const prevSplitMode = wasSplitMode.current
    wasSplitMode.current = layout.splitMode
    const { selectedId: pickedId, justAutoSelected } = autoSelectOnce(bots)
    const activeId = pickedId ?? selectedId
    const action = indexStackAction({
      splitMode: layout.splitMode,
      wasSplitMode: prevSplitMode,
      selectedId: activeId,
      chatMounted: useBotSelection.getState().chatInstances > 0,
      justAutoSelected
    })
    if (action === 'push-chat' && activeId) {
      router.push({ pathname: '/chat', params: { botId: activeId } })
    }
  }, [autoSelectOnce, bots, layout.splitMode, router, selectedId])

  const handleSelectBot = useCallback(
    (bot: Bot) => {
      select(bot.id)
      if (!layout.splitMode) router.push({ pathname: '/chat', params: { botId: bot.id } })
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
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.background, paddingTop: insets.top }}>
      <View key="roster-pane" style={rosterStyle}>
        <Roster bots={bots} sections={sections} selectedId={layout.splitMode ? (selected?.id ?? null) : null} onSelect={handleSelectBot} />
      </View>
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
