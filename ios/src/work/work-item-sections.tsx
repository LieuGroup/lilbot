/** Settled check cards and footer navigation links for `WorkItemPage`. */
import { Pressable, View } from 'react-native'
import { checkerLabel, itemTimestamp } from '../../../shared/client/work/work-lines'
import type { WorkCheck } from '../../../shared/work-check-schema'
import type { Evidence, WorkItem } from '../../../shared/work-schema'
import { ChevronRightIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { radius } from '../ui/tokens'
import { EvidenceCard } from './evidence-card'
import { WORK_DATE_LABELS } from './format-labels'

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
      <AppText variant="meta" color={theme.mutedForeground}>
        The check, by {checkerLabel(check, item.ownerName)}
        {item.checks.length > 1 ? ` · round ${check.round}` : ''}
      </AppText>
      <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor, backgroundColor: theme.card, paddingHorizontal: 12, paddingVertical: 10, gap: 8 }}>
        {check.text ? (
          <AppText variant="preview" color={theme.foreground}>
            {check.text}
          </AppText>
        ) : null}
        {entries.length > 0 ? <EvidenceCard entries={entries} now={now} /> : null}
        <AppText variant="meta" color={theme.mutedForeground}>
          {foot}
        </AppText>
      </View>
    </View>
  )
}

export function WorkFooterLinks({
  item,
  onOpenItem,
  onOpenBot,
  onOpenThread
}: {
  item: WorkItem
  onOpenItem?: (itemId: string) => void
  onOpenBot?: (botId: string) => void
  onOpenThread?: (botId: string, threadId: string) => void
}) {
  const theme = useTheme()
  const originBot = item.origin.kind === 'exchange' && item.askedBy.kind === 'bot' && item.askedBy.id ? item.askedBy.id : item.ownerId

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 4 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {item.parentId && onOpenItem ? <FooterLink label="Part of parent item" onPress={() => onOpenItem(item.parentId!)} /> : null}
        {item.goalId ? (
          <AppText variant="meta" color={theme.mutedForeground}>
            Linked to a goal (open on web)
          </AppText>
        ) : null}
      </View>

      {item.origin.kind === 'exchange' || item.origin.kind === 'group' ? (
        onOpenThread ? (
          <FooterLink label={item.origin.kind === 'group' ? 'Open the group' : 'Open the exchange'} onPress={() => onOpenThread(originBot, item.origin.id)} />
        ) : null
      ) : item.origin.kind === 'routine_run' ? (
        <AppText variant="meta" color={theme.mutedForeground}>
          From a routine run
        </AppText>
      ) : item.origin.kind === 'webhook_run' ? (
        <AppText variant="meta" color={theme.mutedForeground}>
          From a webhook run
        </AppText>
      ) : onOpenBot ? (
        <FooterLink label="Open the chat" onPress={() => onOpenBot(item.ownerId)} />
      ) : null}
    </View>
  )
}

function FooterLink({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useTheme()
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 2, opacity: pressed ? 0.6 : 1 })}>
      <AppText variant="meta" color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
        {label}
      </AppText>
      <ChevronRightIcon color={theme.mutedForeground} size={13} />
    </Pressable>
  )
}
