/** "Today" tab on the Work board (`R3-06`, mirrors `web/src/work/work-today-page.tsx`):
 *  date heading, brief subtitle, `Needs you`, `Checks that failed`, and collapsible `Done` breakdown. */
import { Fragment, useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { briefSubtitle, checkSummaryLine, doneBreakdown, failedCheckItems, todayHeading } from '../../../shared/client/work/work-lines'
import { CheckIcon, ChevronRightIcon } from '../ui/icon'
import { sheetScrollBottomPadding } from '../ui/keyboard-sheet'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { KEYBOARD_SCROLL_PROPS, useKeyboardHeight } from '../ui/use-keyboard-height'
import { WORK_TYPE_CAPS } from './board-state'
import { CheckBadge } from './check-badge'
import { NeedsYouWorkCard } from './needs-you-card'
import { useWorkBrief } from './store'
import { WorkAvatar } from './work-avatar'

export function WorkTodayPage({ onOpenItem }: { onOpenItem: (itemId: string) => void }) {
  const theme = useTheme()
  const keyboardHeight = useKeyboardHeight()
  const { brief, active, error } = useWorkBrief()
  const [doneOpen, setDoneOpen] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const handle = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(handle)
  }, [])

  const now = tick >= 0 ? Date.now() : Date.now()

  if (!brief) {
    return (
      <View style={{ padding: 16 }}>
        <AppText variant="preview" color={error ? theme.destructive : theme.mutedForeground}>
          {error || 'Loading today’s brief...'}
        </AppText>
      </View>
    )
  }

  const failed = failedCheckItems(active, brief.since)
  const workingCount = active.filter(item => item.status === 'open' || item.status === 'working' || item.status === 'checking').length
  const needsCount = brief.needsOscar.length
  const breakdown = doneBreakdown(brief.done.items)
  const doneLabel = brief.done.count === 1 ? '1 item done today' : `${brief.done.count} items done today`

  return (
    <ScrollView
      testID="work-today-page"
      {...KEYBOARD_SCROLL_PROPS}
      scrollIndicatorInsets={{ bottom: keyboardHeight }}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: sheetScrollBottomPadding(28, keyboardHeight), gap: 18 }}
    >
      {error ? <AppText variant="preview" color={theme.destructive}>{error}</AppText> : null}

      <View style={{ gap: 2 }}>
        <AppText variant="title" color={theme.foreground}>{todayHeading(now)}</AppText>
        <AppText variant="preview" color={theme.mutedForeground}>
          {briefSubtitle({ needs: needsCount, failed: failed.length, done: brief.done.count, working: workingCount })}
        </AppText>
      </View>

      {needsCount > 0 ? (
        <View style={{ gap: 8 }}>
          <AppText variant="meta" color={theme.mutedForeground}>Needs you</AppText>
          {brief.needsOscar.map(item => (
            <NeedsYouWorkCard key={item.id} item={item} now={now} onOpenItem={onOpenItem} />
          ))}
        </View>
      ) : null}

      {failed.length > 0 ? (
        <View style={{ gap: 8 }}>
          <AppText variant="meta" color={theme.mutedForeground}>Checks that failed</AppText>
          {failed.map(item => (
            <Pressable
              key={item.id}
              testID={`work-failed-${item.id}`}
              onPress={() => onOpenItem(item.id)}
              accessibilityRole="button"
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: `${theme.destructive}59`,
                backgroundColor: theme.card,
                paddingHorizontal: 14,
                paddingVertical: 12,
                opacity: pressed ? 0.72 : 1
              })}
            >
              <WorkAvatar id={item.ownerId} name={item.ownerName} size={22} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <AppText variant="name" color={theme.foreground} numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={{ fontFamily: 'Inter_500Medium' }}>
                  {item.title}
                </AppText>
                <AppText variant="meta" color={theme.destructive} numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta}>
                  {checkSummaryLine(item)}
                </AppText>
              </View>
              <ChevronRightIcon color={theme.mutedForeground} size={14} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <AppText variant="meta" color={theme.mutedForeground}>Done</AppText>
        <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, overflow: 'hidden' }}>
          <Pressable
            testID="work-today-done-toggle"
            onPress={() => brief.done.count > 0 && setDoneOpen(open => !open)}
            accessibilityRole="button"
            accessibilityState={{ expanded: doneOpen }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 12,
              opacity: pressed && brief.done.count > 0 ? 0.7 : 1
            })}
          >
            <View style={{ transform: [{ rotate: doneOpen ? '90deg' : '0deg' }] }}>
              <ChevronRightIcon color={theme.mutedForeground} size={14} />
            </View>
            <AppText variant="name" color={theme.foreground} style={{ flex: 1, minWidth: 120, fontFamily: 'Inter_500Medium' }}>
              {brief.done.count > 0 ? doneLabel : 'No items done today'}
            </AppText>
            {breakdown.verified > 0 ? <CountPill text={`${breakdown.verified} verified`} tone="success" /> : null}
            {breakdown.selfChecked > 0 ? <CountPill text={`${breakdown.selfChecked} self-checked`} tone="ink" /> : null}
            {breakdown.notChecked > 0 ? <CountPill text={`${breakdown.notChecked} not checked`} tone="muted" /> : null}
          </Pressable>

          {doneOpen && brief.done.items.length > 0 ? (
            <View style={{ borderTopWidth: 1, borderTopColor: theme.hairline }}>
              {brief.done.items.map((item, index) => (
                <Fragment key={item.id}>
                  {index > 0 ? <View style={{ height: 1, backgroundColor: theme.hairline }} /> : null}
                  <Pressable
                    onPress={() => onOpenItem(item.id)}
                    accessibilityRole="button"
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 11, opacity: pressed ? 0.7 : 1 })}
                  >
                    <WorkAvatar id={item.ownerId} name={item.ownerName} size={20} />
                    <AppText variant="name" color={theme.foreground} numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={{ flex: 1 }}>
                      {item.title}
                    </AppText>
                    <CheckBadge item={item} />
                  </Pressable>
                </Fragment>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </ScrollView>
  )
}

function CountPill({ text, tone }: { text: string; tone: 'success' | 'ink' | 'muted' }) {
  const theme = useTheme()
  const bg = tone === 'success' ? `${theme.success}1F` : theme.muted
  const color = tone === 'success' ? theme.success : tone === 'ink' ? theme.foreground : theme.mutedForeground
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, backgroundColor: bg, paddingHorizontal: 8, paddingVertical: 2 }}>
      {tone === 'success' ? <CheckIcon color={theme.success} size={11} /> : null}
      <AppText variant="meta" color={color} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={{ fontFamily: 'Inter_500Medium' }}>
        {text}
      </AppText>
    </View>
  )
}
