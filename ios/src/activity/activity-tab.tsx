/** Bot Details > Activity tab (`R3-05`): Now status card, Routines card, and Webhooks card on `MOBILE_SCALE.details`. */
import { useEffect, useState } from 'react'
import { ScrollView, useWindowDimensions, View } from 'react-native'
import type { Bot } from '../../../shared/bot-schema'
import { formatElapsed } from '../../../shared/client/activity/activity-since'
import { rowState } from '../../../shared/client/bots/row-state'
import { WorkingSpinner } from '../bots/status-marks'
import { useBotStore } from '../bots/store'
import { RoutinesCard } from '../routines/routines-card'
import { DYNAMIC_TYPE_CAPS, rosterRowTextLines } from '../ui/dynamic-type'
import { SectionGroup } from '../ui/grouped-card'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE } from '../ui/tokens'
import { WebhooksCard } from '../webhooks/webhooks-card'

export function ActivityTab({ bot, bottomPadding = 28 }: { bot: Bot; bottomPadding?: number }) {
  const theme = useTheme()
  const { fontScale } = useWindowDimensions()
  const rowLines = rosterRowTextLines(fontScale)
  const since = useBotStore(state => state.since[bot.id])
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [])

  const state = rowState(bot)
  const title = state.tone === 'idle' ? 'Idle' : state.text
  const machine = bot.activity?.machine ?? 'leader'
  const elapsed = since ? formatElapsed(Math.max(0, now - since)) : ''
  const meta =
    state.tone === 'working'
      ? elapsed
        ? `Working on ${machine} · ${elapsed}`
        : `Working on ${machine}`
      : elapsed
        ? `${state.tone === 'failed' ? 'Stopped' : 'Updated'} · ${elapsed}`
        : state.tone === 'idle'
          ? 'Waiting for a message'
          : bot.function || 'Ready'

  return (
    <ScrollView testID="bot-details-activity" contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: bottomPadding }}>
      <SectionGroup title="Now">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 14 }}>
          {state.tone === 'working' ? (
            <WorkingSpinner color={theme.primary} size={16} />
          ) : (
            <View
              style={{
                width: 9,
                height: 9,
                borderRadius: 4.5,
                backgroundColor: state.tone === 'failed' ? theme.destructive : state.tone === 'finished' ? theme.success : theme.mutedForeground,
                opacity: state.tone === 'idle' ? 0.4 : 1
              }}
            />
          )}
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <AppText
              variant="name"
              color={state.tone === 'failed' ? theme.destructive : theme.foreground}
              numberOfLines={2}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowName}
              style={MOBILE_SCALE.details.rowTitle}
            >
              {title}
            </AppText>
            <AppText
              variant="preview"
              color={theme.mutedForeground}
              numberOfLines={rowLines}
              maxFontSizeMultiplier={DYNAMIC_TYPE_CAPS.rowPreview}
              style={MOBILE_SCALE.details.rowSubtitle}
            >
              {meta}
            </AppText>
          </View>
        </View>
      </SectionGroup>

      <RoutinesCard botId={bot.id} botName={bot.name} now={now} />
      <WebhooksCard botId={bot.id} botName={bot.name} now={now} />
    </ScrollView>
  )
}
