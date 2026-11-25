/** Bot Details (`R3-05`, 3 tabs only: Activity, Library, Setup — Memory lives exclusively in Settings > Memory).
 *  Used both as the pushed `/bot-details` Stack screen on compact iPhone (`compact`, where the native nav bar
 *  holds the `[Avatar + Name]` pill) and as the right-hand inspector pane inside `DuoShell` on Unfolded Duo.
 *  Supports horizontal tab swipe with the leading 20 pt edge yielded to iOS native interactive Back. */
import { useMemo, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { Gesture, GestureDetector } from 'react-native-gesture-handler'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ActivityTab } from '../activity/activity-tab'
import { LibraryTab } from '../library/library-tab'
import { BotAvatar } from '../ui/avatar'
import { evaluateTabSwipe } from '../ui/gestures/rules'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { BOT_DETAILS_TABS, type BotDetailsTab, normalizeBotDetailsTab } from './details-tabs'
import { SetupTab } from './setup-tab'
import { useBotStore } from './store'

export function BotDetailsScreen({
  botId,
  initialTab,
  compact = false
}: {
  botId: string
  initialTab?: string
  compact?: boolean
}) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const bot = useBotStore(state => state.bots.find(candidate => candidate.id === botId) ?? null)
  const [tab, setTab] = useState<BotDetailsTab>(() => normalizeBotDetailsTab(initialTab))
  const startXRef = useRef(0)
  const activeIndex = BOT_DETAILS_TABS.findIndex(entry => entry.id === tab)

  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .runOnJS(true)
        .activeOffsetX([-24, 24])
        .failOffsetY([-12, 12])
        .onBegin(event => {
          startXRef.current = event.absoluteX
        })
        .onEnd(event => {
          const nextIndex = evaluateTabSwipe({
            startX: startXRef.current,
            dx: event.translationX,
            dy: event.translationY,
            activeIndex,
            count: BOT_DETAILS_TABS.length
          })
          if (nextIndex !== activeIndex) setTab(BOT_DETAILS_TABS[nextIndex].id)
        }),
    [activeIndex]
  )

  if (!bot) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <AppText variant="preview" color={theme.mutedForeground}>
          Bot not found.
        </AppText>
      </View>
    )
  }

  const bottomPadding = Math.max(32, insets.bottom + 18)

  return (
    <View testID="bot-details-screen" style={{ flex: 1, backgroundColor: theme.background }}>
      <View style={{ paddingHorizontal: 16, paddingTop: compact ? 8 : 4, paddingBottom: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: theme.hairline }}>
        {!compact ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <BotAvatar name={bot.name} avatar={bot.prefs.avatar} size={40} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <AppText variant="title" numberOfLines={1}>
                {bot.name}
              </AppText>
              {bot.function ? (
                <AppText variant="meta" color={theme.mutedForeground} numberOfLines={2}>
                  {bot.function}
                </AppText>
              ) : null}
            </View>
          </View>
        ) : null}

        <View testID="bot-details-tabs" accessibilityRole="tablist" style={{ flexDirection: 'row', borderRadius: 11, backgroundColor: theme.muted, padding: 3, gap: 2 }}>
          {BOT_DETAILS_TABS.map(entry => {
            const active = entry.id === tab
            return (
              <Pressable
                key={entry.id}
                testID={`bot-details-tab-${entry.id}`}
                onPress={() => setTab(entry.id)}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={{
                  flex: 1,
                  minHeight: 38,
                  paddingHorizontal: 6,
                  paddingVertical: 6,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: active ? theme.foreground : 'transparent'
                }}
              >
                <AppText
                  variant="preview"
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.75}
                  maxFontSizeMultiplier={1.25}
                  color={active ? theme.background : theme.mutedForeground}
                  style={{ fontFamily: active ? 'Inter_600SemiBold' : 'Inter_500Medium' }}
                >
                  {entry.label}
                </AppText>
              </Pressable>
            )
          })}
        </View>
      </View>

      <GestureDetector gesture={swipeGesture}>
        <View style={{ flex: 1 }}>
          {tab === 'activity' ? <ActivityTab bot={bot} bottomPadding={bottomPadding} /> : null}
          {tab === 'library' ? <LibraryTab bot={bot} bottomPadding={bottomPadding} /> : null}
          {tab === 'setup' ? <SetupTab bot={bot} bottomPadding={bottomPadding} /> : null}
        </View>
      </GestureDetector>
    </View>
  )
}
