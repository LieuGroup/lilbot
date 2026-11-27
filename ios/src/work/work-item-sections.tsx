/** Settled check cards, sent-back/done status banners, and footer navigation links for `WorkItemPage` (`MOBILE_SCALE.work`). */
import { Pressable, View } from 'react-native'
import { checkerLabel, itemTimestamp } from '../../../shared/client/work/work-lines'
import type { WorkCheck } from '../../../shared/work-check-schema'
import type { Evidence, WorkItem } from '../../../shared/work-schema'
import { CheckIcon, ChevronRightIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { WORK_TYPE_CAPS } from './board-state'
import { CheckBadge } from './check-badge'
import { EvidenceCard } from './evidence-card'
import { clockTime, WORK_DATE_LABELS } from './format-labels'

export function SentBackBanner({ heading, claimed, noteLabel, note, footer }: { heading: string; claimed: string; noteLabel: string; note?: string | null; footer: string }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 8, borderRadius: radius.lg, backgroundColor: `${theme.destructive}14`, paddingHorizontal: 14, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <CloseIcon color={theme.destructive} size={15} />
        <AppText color={theme.destructive} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { flex: 1, fontFamily: 'Inter_600SemiBold' }]}>
          {heading}
        </AppText>
      </View>
      <View style={{ gap: 4 }}>
        {claimed ? (
          <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.rowMeta}>
            <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.rowMeta}>Claimed: </AppText>
            {claimed}
          </AppText>
        ) : null}
        {note ? (
          <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.rowMeta}>
            <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.rowMeta}>{noteLabel}</AppText>
            {note}
          </AppText>
        ) : null}
      </View>
      <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{footer}</AppText>
    </View>
  )
}

export function DoneBanner({ item }: { item: WorkItem }) {
  const theme = useTheme()
  const verified = item.checkLevel >= 2 && (item.check?.state === 'verified' || item.check?.state === 'passed')
  const finishTime = item.finishedAt ? clockTime(item.finishedAt) : ''

  if (verified && item.check) {
    const label = item.check.state === 'passed' ? 'Done · passed by you' : `Done · verified by ${checkerLabel(item.check, item.ownerName)}`
    return (
      <View style={{ gap: 8, borderRadius: radius.lg, backgroundColor: `${theme.success}14`, paddingHorizontal: 14, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CheckIcon color={theme.success} size={15} />
          <AppText color={theme.success} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowTitle} style={[MOBILE_SCALE.work.rowTitle, { flex: 1, fontFamily: 'Inter_600SemiBold' }]}>
            {label}
          </AppText>
          {finishTime ? <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={MOBILE_SCALE.work.chip}>{finishTime}</AppText> : null}
        </View>
        {item.result ? <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>{item.result}</AppText> : null}
      </View>
    )
  }

  return (
    <View style={{ gap: 8, borderRadius: radius.lg, backgroundColor: theme.muted, paddingHorizontal: 14, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <CheckBadge item={item} />
        {finishTime ? <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.badge} style={MOBILE_SCALE.work.chip}>{finishTime}</AppText> : null}
      </View>
      {item.result ? <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>{item.result}</AppText> : null}
    </View>
  )
}

export function WorkCheckCard({ item, check, entries, now }: { item: WorkItem; check: WorkCheck; entries: Evidence[]; now: number }) {
  const theme = useTheme()
  const borderColor =
    check.state === 'verified' || check.state === 'passed'
      ? `${theme.success}66`
      : check.state === 'not_verified' || check.state === 'could_not_check' || check.state === 'sent_back'
        ? `${theme.destructive}66`
        : theme.hairline
  const foot =
    check.by.kind === 'oscar'
      ? `Checked by you · ${itemTimestamp(check.settledAt ?? check.at, now, WORK_DATE_LABELS)}`
      : check.sameBot
        ? check.note || 'Fresh isolated session · no memory · changed nothing'
        : `Chosen by LilBot, not by ${item.ownerName} · changed nothing`

  return (
    <View style={{ gap: 6 }}>
      <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.sectionHeader} style={[MOBILE_SCALE.work.sectionHeader, { fontFamily: 'Inter_500Medium' }]}>
        The check, by {checkerLabel(check, item.ownerName)}{item.checks.length > 1 ? ` · round ${check.round}` : ''}
      </AppText>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor, backgroundColor: theme.card, paddingHorizontal: 14, paddingVertical: 12, gap: 8 }}>
        {check.text ? <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.body} style={MOBILE_SCALE.work.body}>{check.text}</AppText> : null}
        {entries.length > 0 ? <EvidenceCard entries={entries} now={now} /> : null}
        <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>{foot}</AppText>
      </View>
    </View>
  )
}

export function WorkFooterLinks({ item, onOpenItem, onOpenBot, onOpenThread }: { item: WorkItem; onOpenItem?: (itemId: string) => void; onOpenBot?: (botId: string) => void; onOpenThread?: (botId: string, threadId: string) => void }) {
  const theme = useTheme()
  const originBot = item.origin.kind === 'exchange' && item.askedBy.kind === 'bot' && item.askedBy.id ? item.askedBy.id : item.ownerId

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 4 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {item.parentId && onOpenItem ? <FooterLink label="Part of parent item" onPress={() => onOpenItem(item.parentId!)} /> : null}
        {item.goalId ? <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>Linked to a goal (open on web)</AppText> : null}
      </View>
      {item.origin.kind === 'exchange' || item.origin.kind === 'group' ? (
        onOpenThread ? <FooterLink label={item.origin.kind === 'group' ? 'Open the group' : 'Open the exchange'} onPress={() => onOpenThread(originBot, item.origin.id)} /> : null
      ) : item.origin.kind === 'routine_run' ? (
        <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>From a routine run</AppText>
      ) : item.origin.kind === 'webhook_run' ? (
        <AppText color={theme.mutedForeground} maxFontSizeMultiplier={WORK_TYPE_CAPS.rowMeta} style={MOBILE_SCALE.work.rowMeta}>From a webhook run</AppText>
      ) : onOpenBot ? (
        <FooterLink label="Open the chat" onPress={() => onOpenBot(item.ownerId)} />
      ) : null}
    </View>
  )
}

function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, opacity: pressed ? 0.6 : 1 })}>
      <AppText color={theme.foreground} maxFontSizeMultiplier={WORK_TYPE_CAPS.actionButton} style={[MOBILE_SCALE.work.rowMeta, { fontFamily: 'Inter_500Medium' }]}>{label}</AppText>
      <ChevronRightIcon color={theme.mutedForeground} size={14} />
    </Pressable>
  )
}
