/** Work tab root screen: hosts the Work board (`Today · All work · Checks`), pushing `/item` on compact surfaces
 *  and showing the keyed `WorkItemPage` beside the board on split surfaces (Unfolded Duo Landscape / iPad).
 *  On Duo (iOS 27.1+), places Checks `Add` and split-item `Drop…` in the 84 pt side strip with zero horizontal header. */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useBotStore } from '../../../bots/store'
import { computeShellLayout } from '../../../duo/layout'
import { useBotSelection } from '../../../duo/selection'
import { useLiveSurface, useVerticalBarEdge } from '../../../duo/use-surface'
import { buildDuoVerticalBarItems, duoVerticalHeaderOptions, isDuoVerticalBarActive } from '../../../duo/vertical-bar'
import { openThreadView } from '../../../threads/store'
import { AppText } from '../../../ui/text'
import { useTheme } from '../../../ui/theme'
import { MOBILE_SCALE } from '../../../ui/tokens'
import { isDroppableItem } from '../../../work/action-state'
import { WORK_TYPE_CAPS, type WorkBoardTab } from '../../../work/board-state'
import { useWorkStore } from '../../../work/store'
import { WorkBoard } from '../../../work/work-board'
import { WorkItemPage } from '../../../work/work-item-page'

export default function WorkTabScreen() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ itemId?: string }>()
  const { surface, metrics } = useLiveSurface()
  const verticalBarEdge = useVerticalBarEdge()
  const bots = useBotStore(state => state.bots)
  const selectBot = useBotSelection(state => state.select)
  const layout = computeShellLayout(surface, metrics)
  const verticalBarActive = isDuoVerticalBarActive({ surface, verticalBarEdge })
  const hasFloatingTabBar = surface === 'phone' || surface === 'duo-unfolded-portrait'
  const [activeTab, setActiveTab] = useState<WorkBoardTab>('today')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [addOverrideOpen, setAddOverrideOpen] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const selectedItem = useWorkStore(s => (selectedItemId ? s.items[selectedItemId] : undefined))

  useEffect(() => {
    const incoming = typeof params.itemId === 'string' && params.itemId ? params.itemId : null
    if (incoming && layout.splitMode) setSelectedItemId(incoming)
  }, [params.itemId, layout.splitMode])

  useEffect(() => {
    setDropOpen(false)
  }, [selectedItemId])

  const handleOpenItem = useCallback(
    (itemId: string) => {
      if (layout.splitMode) {
        setSelectedItemId(itemId)
        return
      }
      router.push({ pathname: '/(tabs)/(work)/item', params: { itemId } })
    },
    [layout.splitMode, router]
  )

  const handleOpenBot = useCallback(
    (botId: string) => {
      selectBot(botId)
      if (layout.splitMode) router.navigate('/(tabs)/(bots)')
      else router.navigate({ pathname: '/(tabs)/(bots)/chat', params: { botId } })
    },
    [layout.splitMode, router, selectBot]
  )

  const handleOpenThread = useCallback(
    (botId: string, threadId: string) => {
      openThreadView(botId, threadId)
      if (layout.splitMode) {
        selectBot(botId)
        router.navigate('/(tabs)/(bots)')
      }
    },
    [layout.splitMode, router, selectBot]
  )

  const canDropSelected = Boolean(layout.splitMode && selectedItemId && isDroppableItem(selectedItem))
  const canAddOverride = activeTab === 'checks' && bots.length > 0

  const headerOptions = useMemo(() => {
    if (!verticalBarActive) return { headerShown: false, unstable_headerRightItems: undefined }
    const barItems = buildDuoVerticalBarItems({
      screen: layout.splitMode ? 'work-split' : 'work-board-checks',
      tintColor: theme.foreground,
      actions: {
        ...(canDropSelected ? { 'drop-work': { label: 'Drop item', onPress: () => setDropOpen(true) } } : {}),
        ...(canAddOverride ? { 'add-check-override': { label: 'Add bot check level', onPress: () => setAddOverrideOpen(true) } } : {})
      }
    })
    return duoVerticalHeaderOptions(barItems, theme.foreground)
  }, [verticalBarActive, layout.splitMode, canDropSelected, canAddOverride, theme.foreground])

  return (
    <>
      <Stack.Screen options={headerOptions} />
      <View
        style={{
          flex: 1,
          flexDirection: layout.splitMode ? 'row' : 'column',
          backgroundColor: theme.background,
          paddingTop: insets.top,
          paddingLeft: layout.horizontalPadding.left,
          paddingRight: layout.horizontalPadding.right
        }}
      >
        <View style={layout.splitMode ? { width: Math.max(layout.rosterWidth, 340), borderRightWidth: 1, borderRightColor: theme.hairline } : { flex: 1 }}>
          <WorkBoard
            tab={activeTab}
            onTabChange={setActiveTab}
            selectedItemId={layout.splitMode ? selectedItemId : null}
            showAddOverrideButton={!verticalBarActive}
            addOverrideOpen={addOverrideOpen}
            onAddOverrideOpenChange={setAddOverrideOpen}
            hasFloatingTabBar={hasFloatingTabBar}
            onOpenItem={handleOpenItem}
          />
        </View>
        {layout.splitMode ? (
          <View style={{ flex: 1 }}>
            {selectedItemId ? (
              <WorkItemPage
                key={selectedItemId}
                itemId={selectedItemId}
                showDropButton={!verticalBarActive}
                dropOpen={dropOpen}
                onDropOpenChange={setDropOpen}
                onOpenItem={setSelectedItemId}
                onOpenBot={handleOpenBot}
                onOpenThread={handleOpenThread}
              />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>
                  Pick a work item to inspect its evidence and check status.
                </AppText>
              </View>
            )}
          </View>
        ) : null}
      </View>
    </>
  )
}
