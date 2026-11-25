/** Compact Bot Details pushed inside the Bots native Stack (`/(tabs)/(bots)/bot-details`).
 *  Shows Activity, Library, and Setup tabs (no Memory tab; Memory lives in Settings > Memory). */
import { Stack, useLocalSearchParams } from 'expo-router'
import { Pressable, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { BotDetailsScreen } from '../../../bots/details-screen'
import { useBotMenuStore } from '../../../bots/menu-store'
import { useBotStore } from '../../../bots/store'
import { computeShellLayout } from '../../../duo/layout'
import { useBotSelection } from '../../../duo/selection'
import { useLiveSurface } from '../../../duo/use-surface'
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
  const layout = computeShellLayout(surface, metrics)
  const selectedId = useBotSelection(state => state.selectedId)
  const bots = useBotStore(state => state.bots)
  const openMenu = useBotMenuStore(state => state.openMenu)

  const botId = (typeof params.botId === 'string' && params.botId) || selectedId || ''
  const initialTab = typeof params.tab === 'string' ? params.tab : undefined
  const bot = bots.find(candidate => candidate.id === botId) ?? null

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: bot?.name ?? 'Bot details',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.foreground,
          headerBackButtonDisplayMode: 'minimal',
          gestureEnabled: true,
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
                  onPress={() => openMenu(bot.id)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`More for ${bot.name}`}
                  style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}
                >
                  <MoreHorizontalIcon color={theme.foreground} size={16} />
                </Pressable>
              )
            : undefined
        }}
      />
      <View style={{ flex: 1, backgroundColor: theme.background, paddingTop: layout.hasSideStrip ? Math.max(12, insets.top) : 0, paddingLeft: layout.horizontalPadding.left, paddingRight: layout.horizontalPadding.right }}>
        <BotDetailsScreen botId={botId} initialTab={initialTab} compact={!layout.hasSideStrip} />
      </View>
    </>
  )
}
