/** Compact Work item detail route pushed inside the Work stack (`/(tabs)/(work)/item`). */
import { Stack, useLocalSearchParams, useRouter } from 'expo-router'
import { useCallback, useMemo } from 'react'
import { View } from 'react-native'
import { computeShellLayout } from '../../../duo/layout'
import { useBotSelection } from '../../../duo/selection'
import { shouldShowNativeBack } from '../../../duo/stack-sync'
import { useLiveSurface, useScreenReaderEnabled } from '../../../duo/use-surface'
import { openThreadView } from '../../../threads/store'
import { useTheme } from '../../../ui/theme'
import { WorkItemPage } from '../../../work/work-item-page'

export default function WorkItemRoute() {
  const theme = useTheme()
  const router = useRouter()
  const params = useLocalSearchParams<{ itemId?: string }>()
  const itemId = typeof params.itemId === 'string' ? params.itemId : ''
  const { surface, metrics } = useLiveSurface()
  const screenReaderEnabled = useScreenReaderEnabled()
  const selectBot = useBotSelection(state => state.select)
  const layout = computeShellLayout(surface, metrics)
  const backVisible = shouldShowNativeBack(surface, screenReaderEnabled)

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
    },
    []
  )

  const screenOptions = useMemo(
    () => ({
      headerShown: true,
      title: 'Work',
      headerBackVisible: backVisible,
      headerBackButtonDisplayMode: 'minimal' as const,
      headerShadowVisible: false,
      headerTintColor: theme.foreground,
      headerStyle: { backgroundColor: theme.background },
      gestureEnabled: true
    }),
    [backVisible, theme.background, theme.foreground]
  )

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <View style={{ flex: 1, backgroundColor: theme.background, paddingLeft: layout.horizontalPadding.left, paddingRight: layout.horizontalPadding.right }}>
        {itemId ? <WorkItemPage itemId={itemId} onOpenItem={handleOpenItem} onOpenBot={handleOpenBot} onOpenThread={handleOpenThread} /> : null}
      </View>
    </>
  )
}
