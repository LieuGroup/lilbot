/** Top status banner of a work item's page across every state (mirrors `web/src/work/work-item-banner.tsx`). */
import { View } from 'react-native'
import { checkerLabel, droppedByLine, elapsedShort, isOscarCheck, latestSettledCheck } from '../../../shared/client/work/work-lines'
import type { WorkItem } from '../../../shared/work-schema'
import { WorkingSpinner } from '../bots/status-marks'
import { CheckIcon, CloseIcon } from '../ui/icon'
import { AppText } from '../ui/text'
import { useTheme } from '../ui/theme'
import { MOBILE_SCALE, radius } from '../ui/tokens'
import { CheckBadge } from './check-badge'
import { clockTime } from './format-labels'
import { OscarCheckBanner, QuestionBanner } from './work-item-actions'

export function WorkItemBanner({ item, now }: { item: WorkItem; now: number }) {
  const theme = useTheme()

  if (item.status === 'done') return <DoneBanner item={item} />
  if (item.status === 'needs_oscar') return isOscarCheck(item) ? <OscarCheckBanner item={item} /> : <QuestionBanner item={item} />

  if (item.status === 'checking') {
    const by = item.check ? checkerLabel(item.check, item.ownerName) : 'a second bot'
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.lg, backgroundColor: `${theme.primary}14`, paddingHorizontal: 14, paddingVertical: 12 }}>
        <WorkingSpinner color={theme.primary} size={14} />
        <AppText variant="preview" color={theme.foreground} style={{ flex: 1, fontFamily: 'Inter_500Medium' }}>
          Being checked by {by}
          {item.check?.model ? ` (${item.check.model.model})` : ''}
        </AppText>
      </View>
    )
  }

  if (item.status === 'failed') {
    return (
      <View style={{ gap: 6, borderRadius: radius.lg, backgroundColor: `${theme.destructive}14`, paddingHorizontal: 14, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CloseIcon color={theme.destructive} size={15} />
          <AppText variant="preview" color={theme.destructive} style={{ fontFamily: 'Inter_600SemiBold' }}>
            Failed
          </AppText>
        </View>
        {item.result ? <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>{item.result}</AppText> : null}
      </View>
    )
  }

  if (item.status === 'dropped') {
    return (
      <View style={{ borderRadius: radius.lg, backgroundColor: theme.muted, paddingHorizontal: 14, paddingVertical: 12 }}>
        <AppText variant="preview" color={theme.mutedForeground} style={{ fontFamily: 'Inter_500Medium' }}>
          {droppedByLine(item)}
        </AppText>
      </View>
    )
  }

  const latest = latestSettledCheck(item.checks)
  if (latest?.state === 'sent_back') {
    return (
      <SentBackBanner
        heading="Sent back by you"
        claimed={item.result}
        noteLabel="Your note: "
        note={latest.text}
        footer={`${item.ownerName} is working on it again.`}
      />
    )
  }
  if (latest?.state === 'not_verified') {
    const failures = item.checks.filter(c => c.state === 'not_verified').length
    return (
      <SentBackBanner
        heading={`Not verified by ${checkerLabel(latest, item.ownerName)} · sent back ${failures === 1 ? 'once' : `${failures} times`}`}
        claimed={item.result}
        noteLabel="The checker saw: "
        note={latest.text}
        footer={`${item.ownerName} is working on it again. A second failure comes to you.`}
      />
    )
  }

  const label = item.status === 'working' ? 'Working' : 'Open'
  const since = item.startedAt ?? item.createdAt
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.lg, backgroundColor: theme.muted, paddingHorizontal: 14, paddingVertical: 12 }}>
      {item.status === 'working' ? <WorkingSpinner color={theme.primary} size={14} /> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.mutedForeground }} />}
      <AppText variant="preview" color={theme.foreground} style={{ fontFamily: 'Inter_500Medium' }}>
        {label} · {elapsedShort(now - since)}
      </AppText>
    </View>
  )
}

function SentBackBanner({ heading, claimed, noteLabel, note, footer }: { heading: string; claimed: string; noteLabel: string; note?: string | null; footer: string }) {
  const theme = useTheme()
  return (
    <View style={{ gap: 8, borderRadius: radius.lg, backgroundColor: `${theme.destructive}14`, paddingHorizontal: 14, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <CloseIcon color={theme.destructive} size={15} />
        <AppText variant="preview" color={theme.destructive} style={{ flex: 1, fontFamily: 'Inter_600SemiBold' }}>
          {heading}
        </AppText>
      </View>
      <View style={{ gap: 4 }}>
        {claimed ? (
          <AppText variant="preview" color={theme.foreground}>
            <AppText variant="preview" color={theme.mutedForeground}>Claimed: </AppText>
            {claimed}
          </AppText>
        ) : null}
        {note ? (
          <AppText variant="preview" color={theme.foreground}>
            <AppText variant="preview" color={theme.mutedForeground}>{noteLabel}</AppText>
            {note}
          </AppText>
        ) : null}
      </View>
      <AppText variant="meta" color={theme.mutedForeground}>{footer}</AppText>
    </View>
  )
}

function DoneBanner({ item }: { item: WorkItem }) {
  const theme = useTheme()
  const verified = item.checkLevel >= 2 && (item.check?.state === 'verified' || item.check?.state === 'passed')
  const finishTime = item.finishedAt ? clockTime(item.finishedAt) : ''

  if (verified && item.check) {
    const label = item.check.state === 'passed' ? 'Done · passed by you' : `Done · verified by ${checkerLabel(item.check, item.ownerName)}`
    return (
      <View style={{ gap: 8, borderRadius: radius.lg, backgroundColor: `${theme.success}14`, paddingHorizontal: 14, paddingVertical: 12 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CheckIcon color={theme.success} size={15} />
          <AppText variant="preview" color={theme.success} style={{ flex: 1, fontFamily: 'Inter_600SemiBold' }}>
            {label}
          </AppText>
          {finishTime ? <AppText variant="meta" color={theme.mutedForeground}>{finishTime}</AppText> : null}
        </View>
        {item.result ? <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>{item.result}</AppText> : null}
      </View>
    )
  }

  return (
    <View style={{ gap: 8, borderRadius: radius.lg, backgroundColor: theme.muted, paddingHorizontal: 14, paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <CheckBadge item={item} />
        {finishTime ? <AppText variant="meta" color={theme.mutedForeground}>{finishTime}</AppText> : null}
      </View>
      {item.result ? <AppText style={MOBILE_SCALE.chat.message} color={theme.foreground}>{item.result}</AppText> : null}
    </View>
  )
}
