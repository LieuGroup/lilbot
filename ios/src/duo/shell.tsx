/** Adaptive iPhone / iPhone Duo shell inside Expo Router's native Stack & NativeTabs.
 *  - Uses native Stack headers and Stack.Toolbar items so UIKit populates the Duo 84 pt side strip,
 *    handles Assistive Access Back, and manages fold/unfold/rotation safe areas natively.
 *  - Keeps Roster and ChatScreen in stable keyed tree positions across fold/unfold so unsent drafts,
 *    scroll offsets, and active chat sessions survive hinge transitions untouched. */
import { Stack } from 'expo-router'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Roster } from '../bots/roster'
import { useBotStore } from '../bots/store'
import { ChatScreen } from '../chat/screen'
import { CloseIcon, SidebarToggleIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { computeShellLayout, nextSidebarState } from './layout'
import { useLiveSurface } from './use-surface'

export interface DuoShellProps {
  renderInspector?: (close: () => void) => ReactNode
}

export function DuoShell({ renderInspector }: DuoShellProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { surface, metrics } = useLiveSurface()
  const bots = useBotStore(state => state.bots)
  const sections = useBotStore(state => state.sections)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [inspectorOpen, setInspectorOpen] = useState(false)

  const selected = bots.find(bot => bot.id === selectedId) ?? null
  const didAutoSelect = useRef(false)
  useEffect(() => {
    if (didAutoSelect.current || bots.length === 0) return
    didAutoSelect.current = true
    setSelectedId((bots.find(bot => bot.isPrimary) ?? bots[0]).id)
  }, [bots])

  const layout = computeShellLayout(surface, metrics, { inspectorOpen: inspectorOpen && !!renderInspector, sidebarOpen })
  const showNativeHeader = !layout.splitMode && selected !== null
  const showRoster = layout.splitMode ? layout.rosterWidth > 0 : selected === null
  const showChat = layout.splitMode || selected !== null

  const handleBack = useCallback(() => {
    if (inspectorOpen) {
      setInspectorOpen(false)
      return
    }
    if (selectedId) setSelectedId(null)
  }, [inspectorOpen, selectedId])

  const handleToggleSidebar = useCallback(() => {
    const next = nextSidebarState({ sidebarOpen, inspectorOpen })
    setSidebarOpen(next.sidebarOpen)
    setInspectorOpen(next.inspectorOpen)
  }, [sidebarOpen, inspectorOpen])

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
    : { flex: 1, display: (showRoster ? 'flex' : 'none') as 'flex' | 'none' }

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: showNativeHeader,
          title: selected?.name ?? 'Bots',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.foreground
        }}
      />
      {showNativeHeader && (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="chevron.left" accessibilityLabel="Back" onPress={handleBack} />
        </Stack.Toolbar>
      )}
      <View style={{ flex: 1, flexDirection: 'row', backgroundColor: theme.background, paddingTop: showNativeHeader ? 0 : insets.top }}>
        <View key="roster-pane" style={rosterStyle}>
          <Roster bots={bots} sections={sections} selectedId={layout.splitMode ? (selected?.id ?? null) : null} onSelect={bot => setSelectedId(bot.id)} />
        </View>
        <View key="chat-pane" style={{ flex: 1, display: showChat ? 'flex' : 'none' }}>
          {selected ? <ChatScreen bot={selected} hideHeader={showNativeHeader} headerLeading={sidebarToggle} /> : <EmptyDetail />}
        </View>
        {layout.inspectorWidth > 0 && renderInspector && (
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
    </>
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
