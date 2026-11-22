/** Top status banner of an item's page across every state (Paper artboard 20, frames 4 and 5). */
import { CheckIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
import type { WorkItem } from '../../../shared/work-schema'
import { clockTime } from '../history/history-labels'
import { CheckBadge } from './check-badge'
import { OscarCheckBanner, QuestionBanner } from './work-item-actions'
import { checkerLabel, droppedByLine, elapsedShort, isOscarCheck, latestSettledCheck } from './work-lines'

export function WorkItemBanner({ item, now }: { item: WorkItem; now: number }) {
  if (item.status === 'done') return <DoneBanner item={item} />
  if (item.status === 'needs_oscar') return isOscarCheck(item) ? <OscarCheckBanner item={item} /> : <QuestionBanner item={item} />
  if (item.status === 'checking') {
    const by = item.check ? checkerLabel(item.check, item.ownerName) : 'a second bot'
    return (
      <div className="flex items-center gap-2 rounded-xl bg-primary/8 px-3.5 py-3">
        <LoaderCircleIcon className="size-3.5 flex-none animate-spin text-primary" strokeWidth={2.8} aria-hidden />
        <span className="text-[13px]/[18px] font-medium text-foreground">
          Being checked by {by}
          {item.check?.model ? ` (${item.check.model.model})` : ''}
        </span>
      </div>
    )
  }
  if (item.status === 'failed') {
    return (
      <div className="flex flex-col gap-1.5 rounded-xl bg-destructive/8 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <XIcon className="size-4 flex-none text-destructive" strokeWidth={2.4} aria-hidden />
          <span className="text-[13px]/[18px] font-semibold text-destructive">Failed</span>
        </div>
        {item.result && <p className="text-sm/[21px] whitespace-pre-wrap text-foreground">{item.result}</p>}
      </div>
    )
  }
  if (item.status === 'dropped') {
    return (
      <div className="rounded-xl bg-background px-3.5 py-3">
        <span className="text-[13px]/[18px] font-medium text-muted-foreground">{droppedByLine(item)}</span>
      </div>
    )
  }

  const latest = latestSettledCheck(item.checks)
  if (latest?.state === 'sent_back') {
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-destructive/8 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <XIcon className="size-4 flex-none text-destructive" strokeWidth={2.4} aria-hidden />
          <span className="text-[13px]/[18px] font-semibold text-destructive">Sent back by you</span>
        </div>
        <div className="flex flex-col gap-0.5 text-[13px]/5 text-foreground">
          {item.result && (
            <p>
              <span className="text-muted-foreground">Claimed: </span>
              {item.result}
            </p>
          )}
          {latest.text && (
            <p>
              <span className="text-muted-foreground">Your note: </span>
              {latest.text}
            </p>
          )}
        </div>
        <p className="text-xs/4 text-muted-foreground">{item.ownerName} is working on it again.</p>
      </div>
    )
  }
  if (latest?.state === 'not_verified') {
    const failures = item.checks.filter(c => c.state === 'not_verified').length
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-destructive/8 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <XIcon className="size-4 flex-none text-destructive" strokeWidth={2.4} aria-hidden />
          <span className="text-[13px]/[18px] font-semibold text-destructive">
            Not verified by {checkerLabel(latest, item.ownerName)} · sent back {failures === 1 ? 'once' : `${failures} times`}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 text-[13px]/5 text-foreground">
          {item.result && (
            <p>
              <span className="text-muted-foreground">Claimed: </span>
              {item.result}
            </p>
          )}
          {latest.text && (
            <p>
              <span className="text-muted-foreground">The checker saw: </span>
              {latest.text}
            </p>
          )}
        </div>
        <p className="text-xs/4 text-muted-foreground">{item.ownerName} is working on it again. A second failure comes to you.</p>
      </div>
    )
  }

  const label = item.status === 'working' ? 'Working' : 'Open'
  const since = item.startedAt ?? item.createdAt
  return (
    <div className="flex items-center gap-2 rounded-xl bg-background px-3.5 py-3">
      {item.status === 'working' ? (
        <LoaderCircleIcon className="size-3.5 flex-none animate-spin text-primary" strokeWidth={2.8} aria-hidden />
      ) : (
        <span className="size-2 flex-none rounded-full bg-foreground/30" />
      )}
      <span className="text-[13px]/[18px] font-medium text-foreground">
        {label} · {elapsedShort(now - since)}
      </span>
    </div>
  )
}

function DoneBanner({ item }: { item: WorkItem }) {
  const verified = item.checkLevel >= 2 && (item.check?.state === 'verified' || item.check?.state === 'passed')
  const finishTime = item.finishedAt ? clockTime(item.finishedAt) : ''
  if (verified && item.check) {
    const label = item.check.state === 'passed' ? 'Done · passed by you' : `Done · verified by ${checkerLabel(item.check, item.ownerName)}`
    return (
      <div className="flex flex-col gap-2 rounded-xl bg-success/8 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <CheckIcon className="size-4 flex-none text-success" strokeWidth={2.4} aria-hidden />
          <span className="min-w-0 flex-1 text-[13px]/[18px] font-semibold text-success">{label}</span>
          {finishTime && <span className="flex-none text-xs/4 text-muted-foreground">{finishTime}</span>}
        </div>
        {item.result && <p className="text-[15px]/6 whitespace-pre-wrap text-foreground">{item.result}</p>}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-background px-3.5 py-3">
      <div className="flex items-center justify-between gap-2">
        <CheckBadge item={item} />
        {finishTime && <span className="text-xs/4 text-muted-foreground">{finishTime}</span>}
      </div>
      {item.result && <p className="text-[15px]/6 whitespace-pre-wrap text-foreground">{item.result}</p>}
    </div>
  )
}
