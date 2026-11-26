/** Full Work item detail view (`MOBILE_SCALE.work`, mirrors `web/src/work/work-item-page.tsx`).
 *  Drop state can be controlled by the route so Duo places `Drop…` in the 84 pt vertical side strip with zero chrome buttons in content.
 *  At AX sizes on ordinary iPhone/split, `Drop…` stacks cleanly below the title so words never break mid-word. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { partitionEvidence } from '../../../shared/client/work/work-groups'
import { askedByLabel, itemTimestamp, levelDescription, levelReason } from '../../../shared/client/work/work-lines'
import { FINAL_WORK } from '../../../shared/work-schema'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { useKeyboardHeight } from '../ui/use-keyboard-height'
import { shouldStackWorkRow, WORK_TYPE_CAPS, workScrollBottomPadding } from './board-state'
import { DropWorkSheet } from './drop-work-sheet'
import { EvidenceCard } from './evidence-card'
import { WORK_DATE_LABELS } from './format-labels'
import { dropWorkItem, useWorkItem } from './store'
import { WorkKeyboardDoneBar } from './work-controls'
import { WorkItemBanner } from './work-item-banner'
import { WorkCheckCard, WorkFooterLinks } from './work-item-sections'
import { WorkRow } from './work-row'
import { type RevealTarget, useRevealAboveKeyboard } from './use-reveal-above-keyboard'

export interface WorkItemPageProps {
  itemId: string
  showDropButton?: boolean
  dropOpen?: boolean
  onDropOpenChange?: (open: boolean) => void
  onOpenItem?: (itemId: string) => void
  onOpenBot?: (botId: string) => void
  onOpenThread?: (botId: string, threadId: string) => void
}

export function WorkItemPage({ itemId, showDropButton = true, dropOpen, onDropOpenChange, onOpenItem, onOpenBot, onOpenThread }: WorkItemPageProps) {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const { fontScale } = useWindowDimensions()
  const keyboardHeight = useKeyboardHeight()
  const { item, error } = useWorkItem(itemId)
  const [localDropOpen, setLocalDropOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const { scrollRef, onScroll, reveal, doneBarHeight } = useRevealAboveKeyboard(keyboardHeight)
  const banner = useRef<RevealTarget>(null)

  useEffect(() => {
    const handle = setInterval(() => setTick(n => n + 1), 30_000)
    return () => clearInterval(handle)
  }, [])

  const revealBanner = useCallback(() => reveal(banner.current), [reveal])

  const now = tick >= 0 ? Date.now() : Date.now()
  const dropping = dropOpen ?? localDropOpen
  const setDropping = (open: boolean) => (onDropOpenChange ? onDropOpenChange(open) : setLocalDropOpen(open))

  if (!item) {
    return (
      <View style={{ flex: 1, padding: 16 }}>
        <AppText color={error ? theme.destructive : theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
          {error || 'Loading item...'}
        </AppText>
      </View>
    )
  }

  const canDrop = !FINAL_WORK.includes(item.status)
  const stackHeader = shouldStackWorkRow(fontScale)
  const evidence = partitionEvidence(item)
  const settledChecks = item.checks.filter(c => c.state !== 'checking')
  const bottomPad = workScrollBottomPadding({ safeBottom: insets.bottom, keyboardHeight, hasFloatingTabBar: false })

  return (
    <View testID={`work-item-page-${item.id}`} style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView ref={scrollRef} onScroll={onScroll} scrollEventThrottle={32} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="none" scrollIndicatorInsets={{ bottom: keyboardHeight }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: bottomPad, gap: 16 }}>
        <View style={{ flexDirection: stackHeader ? 'column' : 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: stackHeader ? 10 : 12 }}>
          <View style={{ flex: stackHeader ? undefined : 1, width: stackHeader ? '100%' : undefined, minWidth: 0, gap: 4 }}>
            <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.pageTitle} style={[MOBILE_SCALE.work.pageTitle, { fontFamily: 'Inter_600SemiBold' }]}>
              {item.title}
            </AppText>
            <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>
              {item.ownerName} · {askedByLabel(item.askedBy)} · {itemTimestamp(item.createdAt, now, WORK_DATE_LABELS)}
            </AppText>
          </View>
          {showDropButton && canDrop ? (
            <Pressable testID={`work-item-drop-${item.id}`} onPress={() => setDropping(true)} hitSlop={6} accessibilityRole="button" style={({ pressed }) => ({ minHeight: 40, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, justifyContent: 'center', opacity: pressed ? 0.65 : 1 })}>
              <AppText maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} color={theme.foreground} style={[MOBILE_SCALE.work.button, { fontFamily: 'Inter_500Medium' }]}>
                Drop…
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {error ? <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{error}</AppText> : null}

        <View ref={banner}>
          <WorkItemBanner item={item} now={now} onInputFocus={revealBanner} />
        </View>

        <View style={{ gap: 4 }}>
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>Done means</AppText>
          <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>{item.done || 'Not written yet.'}</AppText>
        </View>

        <View style={{ gap: 6 }}>
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>Check</AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <View style={{ borderRadius: radius.sm, borderWidth: 1, borderColor: theme.hairline, paddingHorizontal: 8, paddingVertical: 3 }}>
              <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={[MOBILE_SCALE.work.chip, { fontFamily: 'Inter_600SemiBold' }]}>Level {item.checkLevel}</AppText>
            </View>
            <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={MOBILE_SCALE.work.rowTitle}>{levelDescription(item.checkLevel)}</AppText>
          </View>
          <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{levelReason(item)}</AppText>
        </View>

        {evidence.owner.length > 0 ? (
          <View style={{ gap: 6 }}>
            <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>
              Evidence from {item.ownerName} · {evidence.owner.length}
            </AppText>
            <EvidenceCard entries={evidence.owner} now={now} />
          </View>
        ) : null}

        {settledChecks.map(check => <WorkCheckCard key={check.round} item={item} check={check} entries={evidence.byRound[check.round] ?? []} now={now} />)}

        {item.children.length > 0 ? (
          <View style={{ gap: 6 }}>
            <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>
              Parts · {item.children.length}
            </AppText>
            <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: theme.hairline, backgroundColor: theme.card, paddingVertical: 4 }}>
              {item.children.map(child => <WorkRow key={child.id} item={child} now={now} onOpenItem={id => onOpenItem?.(id)} />)}
            </View>
          </View>
        ) : null}

        <WorkFooterLinks item={item} onOpenItem={onOpenItem} onOpenBot={onOpenBot} onOpenThread={onOpenThread} />
      </ScrollView>

      <WorkKeyboardDoneBar keyboardHeight={doneBarHeight} testID="item-keyboard-done" />
      <DropWorkSheet
        visible={dropping}
        itemId={item.id}
        title={item.title}
        hasChildren={item.children.some(c => !FINAL_WORK.includes(c.status))}
        onConfirm={async reason => {
          await dropWorkItem(item.id, reason)
          setDropping(false)
        }}
        onClose={() => setDropping(false)}
      />
    </View>
  )
}
