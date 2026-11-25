/** Work tab root screen: hosts the Work board (`Today · All work · Checks`), pushing `/item` on compact surfaces
 *  and showing the selected `WorkItemPage` beside the board on split surfaces (Unfolded Duo Landscape / iPad). */
import { useRouter } from 'expo-router'
import { useCallback, useState } from 'react'
import { View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { computeShellLayout } from '../../../duo/layout'
import { useBotSelection } from '../../../duo/selection'
import { useLiveSurface } from '../../../duo/use-surface'
import { openThreadView } from '../../../threads/store'
import { AppText } from '../../../ui/text'
import { useTheme } from '../../../ui/theme'
import { WorkBoard } from '../../../work/work-board'
import { WorkItemPage } from '../../../work/work-item-page'

export default function WorkTabScreen() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { surface, metrics } = useLiveSurface()
  const selectBot = useBotSelection(state => state.select)
  const layout = computeShellLayout(surface, metrics)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

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

  return (
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
        <WorkBoard selectedItemId={layout.splitMode ? selectedItemId : null} onOpenItem={handleOpenItem} />
      </View>
      {layout.splitMode ? (
        <View style={{ flex: 1 }}>
          {selectedItemId ? (
            <WorkItemPage itemId={selectedItemId} onOpenItem={setSelectedItemId} onOpenBot={handleOpenBot} onOpenThread={handleOpenThread} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
              <AppText variant="chat" color={theme.mutedForeground}>
                Pick a work item to inspect its evidence and check status.
              </AppText>
            </View>
          )}
        </View>
      ) : null}
    </View>
  )
}
