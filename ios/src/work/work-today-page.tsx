/** "Today" tab on the Work board (`MOBILE_SCALE.work`, mirrors `web/src/work/work-today-page.tsx`):
 *  date heading, brief subtitle, `Needs you` (with draft preservation + keyboard scroll & Done bar), failed checks, and Done. */
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { briefSubtitle, checkSummaryLine, doneBreakdown, failedCheckItems, todayHeading } from '../../../shared/client/work/work-lines'
import type { WorkSummary } from '../../../shared/work-schema'
import { CheckIcon, ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { useKeyboardHeight } from '../ui/use-keyboard-height'
import { mergeTodayNeedsItems, type PreservedTodayDraft } from './action-state'
import { WORK_TYPE_CAPS, workScrollBottomPadding } from './board-state'
import { CheckBadge } from './check-badge'
import { NeedsYouWorkCard } from './needs-you-card'
import { useWorkBrief } from './store'
import { type RevealTarget, useRevealAboveKeyboard } from './use-reveal-above-keyboard'
import { WorkAvatar } from './work-avatar'
import { WorkKeyboardDoneBar } from './work-controls'

export function WorkTodayPage({ onOpenItem, hasFloatingTabBar = false }: { onOpenItem: (itemId: string) => void; hasFloatingTabBar?: boolean }) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const keyboardHeight = useKeyboardHeight()
  const { brief, active, error } = useWorkBrief()
  const [doneOpen, setDoneOpen] = useState(false)
  const [preserved, setPreserved] = useState<Record<string, PreservedTodayDraft>>({})
  const [tick, setTick] = useState(0)
  const { scrollRef, onScroll, reveal, doneBarHeight } = useRevealAboveKeyboard(keyboardHeight)
  const cards = useRef<Record<string, RevealTarget | null>>({})

  useEffect(() => {
    const handle = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(handle)
  }, [])

  const handleDraftChange = useCallback((item: WorkSummary, draft: string, lostOnDisconnect: boolean) => {
    setPreserved(prev => {
      if (!draft.trim() && !lostOnDisconnect) {
        if (!(item.id in prev)) return prev
        const next = { ...prev }
        delete next[item.id]
        return next
      }
      return { ...prev, [item.id]: { item, draft, lostOnDisconnect } }
    })
  }, [])

  const handleDismissStale = useCallback((itemId: string) => {
    setPreserved(prev => {
      if (!(itemId in prev)) return prev
      const next = { ...prev }
      delete next[itemId]
      return next
    })
  }, [])

  const now = tick >= 0 ? Date.now() : Date.now()

  if (!brief) {
    return (
      <View style={{ padding: 16 }}>
        <AppText color={error ? theme.destructive : theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
          {error || 'Loading today’s brief...'}
        </AppText>
      </View>
    )
  }

  const failed = failedCheckItems(active, brief.since)
  const workingCount = active.filter(item => item.status === 'open' || item.status === 'working' || item.status === 'checking').length
  const needsRows = mergeTodayNeedsItems(brief.needsOscar, preserved)
  const breakdown = doneBreakdown(brief.done.items)
  const doneLabel = brief.done.count === 1 ? '1 item done today' : `${brief.done.count} items done today`
  const bottomPad = workScrollBottomPadding({ safeBottom: insets.bottom, keyboardHeight, hasFloatingTabBar })

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} testID="work-today-page" onScroll={onScroll} scrollEventThrottle={32} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="none" scrollIndicatorInsets={{ bottom: keyboardHeight }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: bottomPad, gap: 18 }}>
        {error ? <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{error}</AppText> : null}

        <View style={{ gap: 4 }}>
          <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.pageTitle} style={[MOBILE_SCALE.work.pageTitle, { fontFamily: 'Inter_600SemiBold' }]}>
            {todayHeading(now)}
          </AppText>
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.subtitle} style={MOBILE_SCALE.work.rowMeta}>
            {briefSubtitle({ needs: brief.needsOscar.length, failed: failed.length, done: brief.done.count, working: workingCount })}
          </AppText>
        </View>

        {needsRows.length > 0 ? (
          <View style={{ gap: 8 }}>
            <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>Needs you</AppText>
            {needsRows.map(entry => (
              <View key={entry.item.id} ref={node => { cards.current[entry.item.id] = node }}>
                <NeedsYouWorkCard item={entry.item} now={now} live={entry.live} lostOnDisconnect={entry.lostOnDisconnect} onOpenItem={onOpenItem} onDraftChange={handleDraftChange} onDismissStale={handleDismissStale} onInputFocus={() => reveal(cards.current[entry.item.id] ?? null)} />
              </View>
            ))}
          </View>
        ) : null}

        {failed.length > 0 ? (
          <View style={{ gap: 8 }}>
            <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>Checks that failed</AppText>
            {failed.map(item => (
              <Pressable key={item.id} testID={`work-failed-${item.id}`} onPress={() => onOpenItem(item.id)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.lg, borderWidth: 1, borderColor: `${theme.destructive}59`, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 12, opacity: pressed ? 0.72 : 1 })}>
                <WorkAvatar id={item.ownerId} name={item.ownerName} size={24} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <AppText color={theme.foreground} numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { fontFamily: 'Inter_500Medium' }]}>{item.title}</AppText>
                  <AppText color={theme.destructive} numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{checkSummaryLine(item)}</AppText>
                </View>
                <ChevronRightIcon color={theme.mutedForeground} size={14} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={{ gap: 8 }}>
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>Done</AppText>
          <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, overflow: 'hidden' }}>
            <Pressable testID="work-today-done-toggle" onPress={() => brief.done.count > 0 && setDoneOpen(open => !open)} accessibilityRole="button" accessibilityState={{ expanded: doneOpen }} style={({ pressed }) => ({ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, opacity: pressed && brief.done.count > 0 ? 0.7 : 1 })}>
              <View style={{ transform: [{ rotate: doneOpen ? '90deg' : '0deg' }] }}><ChevronRightIcon color={theme.mutedForeground} size={14} /></View>
              <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { flex: 1, minWidth: 120, fontFamily: 'Inter_500Medium' }]}>
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
                    <Pressable onPress={() => onOpenItem(item.id)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, paddingHorizontal: 14, paddingVertical: 11, opacity: pressed ? 0.7 : 1 })}>
                      <WorkAvatar id={item.ownerId} name={item.ownerName} size={22} />
                      <AppText color={theme.foreground} numberOfLines={2} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { flex: 1 }]}>{item.title}</AppText>
                      <CheckBadge item={item} />
                    </Pressable>
                  </Fragment>
                ))}
              </View>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <WorkKeyboardDoneBar keyboardHeight={doneBarHeight} testID="today-keyboard-done" />
    </View>
  )
}

function CountPill({ text, tone }: { text: string; tone: 'success' | 'ink' | 'muted' }) {
  const theme = useTheme()
  const bg = tone === 'success' ? `${theme.success}1F` : theme.muted
  const color = tone === 'success' ? theme.success : tone === 'ink' ? theme.foreground : theme.mutedForeground
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill, backgroundColor: bg, paddingHorizontal: 9, paddingVertical: 3 }}>
      {tone === 'success' ? <CheckIcon color={theme.success} size={12} /> : null}
      <AppText color={color} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={[MOBILE_SCALE.work.chip, { fontFamily: 'Inter_500Medium' }]}>{text}</AppText>
    </View>
  )
}
