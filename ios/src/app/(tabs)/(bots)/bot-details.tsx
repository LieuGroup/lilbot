/** Compact Bot Details pushed inside the Bots native Stack (`/(tabs)/(bots)/bot-details`).
 *  - Folded Duo (`duo-folded`, iOS 27.1+ vertical bar active): removes the horizontal nav bar completely,
 *    placing native `< Back` and `•••` in the 84 pt vertical strip, and renders one identity block in content.
 *  - Ordinary iPhone / iOS < 27.1: keeps the horizontal `[Avatar + Name]` pill and `•••` in the native bar
 *    with `compact` content (no duplicate identity block). */
import { Stack, useLocalSearchParams } from 'expo-router'
import { useCallback, useMemo } from 'react'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BotDetailsScreen } from '../../../bots/details-screen'
import { useBotMenuStore } from '../../../bots/menu-store'
import { useBotStore } from '../../../bots/store'
import { computeShellLayout } from '../../../duo/layout'
import { useBotSelection } from '../../../duo/selection'
import { useLiveSurface, useVerticalBarEdge } from '../../../duo/use-surface'
import { buildDuoVerticalBarItems, duoVerticalHeaderOptions, isDuoVerticalBarActive } from '../../../duo/vertical-bar'
import { BotAvatar } from '../../../ui/avatar'
import { DYNAMIC_TYPE_CAPS } from '../../../ui/dynamic-type'
import { MoreHorizontalIcon } from '../../../ui/icon'
import { AppText } from '../../../ui/text'
import { useTheme } from '../../../ui/theme'

export default function BotDetailsRoute() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const params = useLocalSearchParams<{ botId?: string; tab?: string }>()
  const { surface, metrics } = useLiveSurface()
  const verticalBarEdge = useVerticalBarEdge()
  const layout = computeShellLayout(surface, metrics)
  const selectedId = useBotSelection(state => state.selectedId)
  const bots = useBotStore(state => state.bots)
  const openMenu = useBotMenuStore(state => state.openMenu)

  const botId = (typeof params.botId === 'string' && params.botId) || selectedId || ''
  const initialTab = typeof params.tab === 'string' ? params.tab : undefined
  const bot = bots.find(candidate => candidate.id === botId) ?? null
  const verticalBarActive = isDuoVerticalBarActive({ surface, verticalBarEdge })

  const openBotMenu = useCallback(() => {
    if (bot) openMenu(bot.id)
  }, [bot, openMenu])

  const verticalBarItems = useMemo(
    () =>
      verticalBarActive && bot
        ? buildDuoVerticalBarItems({
            screen: 'folded-details',
            actions: { 'bot-menu': { label: `More for ${bot.name}`, onPress: openBotMenu } },
            tintColor: theme.foreground
          })
        : [],
    [bot, openBotMenu, theme.foreground, verticalBarActive]
  )

  const screenOptions = useMemo(() => {
    if (verticalBarActive && verticalBarItems.length > 0) {
      return {
        ...duoVerticalHeaderOptions(verticalBarItems, theme.foreground, { backVisible: true }),
        headerRight: undefined,
        gestureEnabled: true
      }
    }
    return {
      headerShown: true,
      title: bot?.name ?? 'Bot details',
      headerShadowVisible: false,
      headerTransparent: false,
      headerStyle: { backgroundColor: theme.background },
      headerTintColor: theme.foreground,
      headerBackButtonDisplayMode: 'minimal' as const,
      gestureEnabled: true,
      unstable_headerRightItems: undefined,
      headerTitle: bot
        ? () => (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                maxWidth: 230,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 9999,
                backgroundColor: theme.card,
                borderWidth: 1,
                borderColor: theme.hairline
              }}
            >
              <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={22} />
              <AppText variant="title" numberOfLines={1} maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.headerTitle} style={{ flexShrink: 1 }}>
                {bot.name}
              </AppText>
            </View>
          )
        : undefined,
      headerRight: bot
        ? () => (
            <Pressable
              testID="bot-details-menu-button"
              onPress={openBotMenu}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`More for ${bot.name}`}
              style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
            >
              <MoreHorizontalIcon color={theme.foreground} size={16} />
            </Pressable>
          )
        : undefined
    }
  }, [bot, openBotMenu, theme.background, theme.card, theme.foreground, theme.hairline, verticalBarActive, verticalBarItems])

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          paddingTop: verticalBarActive ? Math.max(12, insets.top) : 0,
          paddingLeft: layout.horizontalPadding.left,
          paddingRight: layout.horizontalPadding.right
        }}
      >
        <BotDetailsScreen botId={botId} initialTab={initialTab} compact={!verticalBarActive} />
      </View>
    </>
  )
}
