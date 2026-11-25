/** Collapsed 32 pt floating Liquid Glass Tasks pill (`R4-G3`, `R4-01b`, `R4-02b`):
 *  exposes 1-tap ink `Answer` whenever a bot waits on Oscar (at every text size and in both Duo postures),
 *  while swiping up or tapping the status area expands the full dock. */
import { Pressable, View } from 'react-native'
import { PillExpandGesture } from '../ui/gestures/sheet-gesture'
import { GlassPill } from '../ui/glass'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { GLASS_METRICS, radius } from '../ui/tokens'
import { type DockPillModel, THREAD_TYPE_CAPS } from './dock-pill'
import { ChevronUpIcon } from './icons'
import { ThreadStatusIcon } from './thread-badges'

export interface TaskDockPillProps {
  pill: DockPillModel
  wrap: boolean
  onExpand: () => void
  onAnswer: (target: NonNullable<DockPillModel['answerTarget']>) => void
}

export function TaskDockPill({ pill, wrap, onExpand, onAnswer }: TaskDockPillProps) {
  const theme = useTheme()
  return (
    <GlassPill height={GLASS_METRICS.tasksPillHeight} style={{ borderRadius: wrap ? radius.xl : radius.pill }}>
      <View
        testID="tasks-dock-pill"
        style={{
          flexDirection: wrap ? 'column' : 'row',
          alignItems: wrap ? 'stretch' : 'center',
          gap: wrap ? 6 : 8,
          paddingLeft: 12,
          paddingRight: pill.answerTarget ? 6 : 12,
          paddingVertical: wrap ? 8 : 4
        }}
      >
        <View style={{ flex: wrap ? undefined : 1, minWidth: 0 }}>
          <PillExpandGesture accessibilityLabel={pill.accessibilityLabel} onExpand={onExpand}>
            <View testID="tasks-dock-pill-expand" style={{ flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 28 }}>
              <ThreadStatusIcon tone={pill.icon} size={13} />
              <AppText
                variant="preview"
                color={theme.foreground}
                numberOfLines={wrap ? 2 : 1}
                maxFontSizeMultiplier={THREAD_TYPE_CAPS.pillText}
                style={{ fontFamily: 'Inter_500Medium', flexShrink: 1 }}
              >
                {pill.lead}
                {pill.detail ? (
                  <AppText variant="preview" color={theme.mutedForeground} maxFontSizeMultiplier={THREAD_TYPE_CAPS.pillText}>
                    {` · ${pill.detail}`}
                  </AppText>
                ) : null}
              </AppText>
              {!pill.answerTarget ? <ChevronUpIcon color={theme.mutedForeground} size={13} /> : null}
            </View>
          </PillExpandGesture>
        </View>

        {pill.answerTarget ? (
          <Pressable
            testID="tasks-dock-pill-answer"
            onPress={() => onAnswer(pill.answerTarget!)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Answer ${pill.answerTarget.title}`}
            style={({ pressed }) => ({
              alignSelf: wrap ? 'flex-end' : 'center',
              minHeight: 28,
              paddingHorizontal: 12,
              borderRadius: radius.pill,
              backgroundColor: theme.foreground,
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              opacity: pressed ? 0.78 : 1
            })}
          >
            <AppText variant="preview" maxFontSizeMultiplier={THREAD_TYPE_CAPS.actionButton} color={theme.background} style={{ fontFamily: 'Inter_600SemiBold' }}>
              Answer
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </GlassPill>
  )
}
