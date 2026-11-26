/** Compact Work item detail route pushed inside the Work stack (`/(tabs)/(work)/item`).
 *  Hides the floating bottom NativeTabs bar on ordinary iPhone / Duo Unfolded Portrait while focused, and on Duo
 *  (iOS 27.1+) removes the horizontal header row by placing Back and `Drop…` in the 84 pt vertical side strip. */
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { computeShellLayout } from '../../../duo/layout'
import { useBotSelection } from '../../../duo/selection'
import { useLiveSurface, useVerticalBarEdge } from '../../../duo/use-surface'
import { buildDuoVerticalBarItems, duoVerticalHeaderOptions, isDuoVerticalBarActive } from '../../../duo/vertical-bar'
import { openThreadView } from '../../../threads/store'
import { useTheme } from '../../../ui/theme'
import { isDroppableItem } from '../../../work/action-state'
import { useWorkStore } from '../../../work/store'
import { WorkItemPage } from '../../../work/work-item-page'

export default function WorkItemRoute() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ itemId?: string }>()
  const itemId = typeof params.itemId === 'string' ? params.itemId : ''
  const { surface, metrics } = useLiveSurface()
  const verticalBarEdge = useVerticalBarEdge()
  const selectBot = useBotSelection(state => state.select)
  const focusWorkItem = useBotSelection(state => state.focusWorkItem)
  const blurWorkItem = useBotSelection(state => state.blurWorkItem)
  const layout = computeShellLayout(surface, metrics)
  const verticalBarActive = isDuoVerticalBarActive({ surface, verticalBarEdge })
  const item = useWorkStore(s => (itemId ? s.items[itemId] : undefined))
  const [dropOpen, setDropOpen] = useState(false)

  useFocusEffect(
    useCallback(() => {
      focusWorkItem()
      return () => blurWorkItem()
    }, [focusWorkItem, blurWorkItem])
  )

  useEffect(() => {
    setDropOpen(false)
  }, [itemId])

  const handleOpenItem = useCallback(
    (nextId: string) => {
      router.push({ pathname: '/(tabs)/(work)/item', params: { itemId: nextId } })
    },
    [router]
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

  const canDrop = isDroppableItem(item)

  const screenOptions = useMemo(() => {
    if (verticalBarActive) {
      const barItems = buildDuoVerticalBarItems({
        screen: 'work-item',
        tintColor: theme.foreground,
        actions: canDrop ? { 'drop-work': { label: 'Drop item', onPress: () => setDropOpen(true) } } : {}
      })
      return {
        ...duoVerticalHeaderOptions(barItems, theme.foreground, { backVisible: true, keepTransparentWhenEmpty: true }),
        gestureEnabled: true
      }
    }
    return {
      headerShown: true,
      title: 'Work',
      headerBackVisible: true,
      headerBackButtonDisplayMode: 'minimal' as const,
      headerShadowVisible: false,
      headerTintColor: theme.foreground,
      headerStyle: { backgroundColor: theme.background },
      unstable_headerRightItems: undefined,
      gestureEnabled: true
    }
  }, [verticalBarActive, canDrop, theme.background, theme.foreground])

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: verticalBarActive ? insets.top : 0,
          paddingLeft: layout.horizontalPadding.left,
          paddingRight: layout.horizontalPadding.right
        }}
      >
        {itemId ? (
          <WorkItemPage
            key={itemId}
            itemId={itemId}
            showDropButton={!verticalBarActive}
            dropOpen={dropOpen}
            onDropOpenChange={setDropOpen}
            onOpenItem={handleOpenItem}
            onOpenBot={handleOpenBot}
            onOpenThread={handleOpenThread}
          />
        ) : null}
      </View>
    </>
  )
}
