/** "Today" brief tab on the Work board (Paper artboard 20, frame 1). */
import { Link } from '@tanstack/react-router'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { Notice } from '@/ui/notice'
import { useNow } from '../app/use-now'
import { useAllGoals } from '../goals/goal-store'
import { ThreadAvatar } from '../threads/thread-avatar'
import { CheckBadge } from './check-badge'
import { NeedsYouGoalCard, NeedsYouWorkCard } from './needs-you-card'
import { briefSubtitle, checkSummaryLine, doneBreakdown, failedCheckItems, todayHeading } from './work-lines'
import { useWorkBrief } from './work-store'

export default function WorkTodayPage() {
  const now = useNow(30_000)
  const { brief, active, error } = useWorkBrief()
  const { goals } = useAllGoals()
  const [doneOpen, setDoneOpen] = useState(false)

  if (!brief) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-5 text-[13px] text-muted-foreground">{error ? <Notice tone="error">{error}</Notice> : 'Loading today\u2019s brief...'}</div>
    )
  }

  const waitingGoals = goals.filter(g => g.waitsForOscar)
  const failed = failedCheckItems(active, brief.since)
  const workingCount = active.filter(i => i.status === 'open' || i.status === 'working' || i.status === 'checking').length
  const needsCount = brief.needsOscar.length + waitingGoals.length
  const breakdown = doneBreakdown(brief.done.items)
  const doneLabel = brief.done.count === 1 ? '1 item done today' : `${brief.done.count} items done today`

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-[18px] px-5 py-5 md:px-6">
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base/[22px] font-semibold tracking-[-0.01em] text-foreground">{todayHeading(now)}</h2>
        <p className="text-[13px]/5 text-muted-foreground">{briefSubtitle({ needs: needsCount, failed: failed.length, done: brief.done.count, working: workingCount })}</p>
      </div>

      {needsCount > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs/4 text-muted-foreground">Needs you</h3>
          {brief.needsOscar.map(item => (
            <NeedsYouWorkCard key={item.id} item={item} now={now} />
          ))}
          {waitingGoals.map(goal => (
            <NeedsYouGoalCard key={goal.id} goal={goal} />
          ))}
        </section>
      )}

      {failed.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs/4 text-muted-foreground">Checks that failed</h3>
          {failed.map(item => (
            <Link
              key={item.id}
              to="/work/items/$itemId"
              params={{ itemId: item.id }}
              className="flex items-center gap-2 rounded-xl px-3.5 py-3 ring-1 ring-destructive/35 outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ThreadAvatar id={item.ownerId} name={item.ownerName} size={18} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px]/[18px] font-medium text-foreground">{item.title}</span>
                <span className="text-xs/4 text-destructive">{checkSummaryLine(item)}</span>
              </div>
              <ChevronRightIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={1.75} aria-hidden />
            </Link>
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h3 className="text-xs/4 text-muted-foreground">Done</h3>
        <div className="overflow-hidden rounded-xl bg-background">
          <button
            type="button"
            onClick={() => brief.done.count > 0 && setDoneOpen(open => !open)}
            aria-expanded={doneOpen}
            className="flex w-full flex-wrap items-center gap-2 px-3.5 py-3 text-left outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {doneOpen ? (
              <ChevronDownIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={1.75} aria-hidden />
            ) : (
              <ChevronRightIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={1.75} aria-hidden />
            )}
            <span className="min-w-0 flex-1 text-[13px]/[18px] font-medium text-foreground">{brief.done.count > 0 ? doneLabel : 'No items done today'}</span>
            {breakdown.verified > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-success/12 py-px pr-2 pl-1.5 text-xs/4 font-medium text-success">
                <CheckIcon className="size-3" strokeWidth={2.6} aria-hidden />
                {breakdown.verified} verified
              </span>
            )}
            {breakdown.selfChecked > 0 && (
              <span className="rounded-full bg-foreground/6 px-2 py-px text-xs/4 font-medium text-foreground">{breakdown.selfChecked} self-checked</span>
            )}
            {breakdown.notChecked > 0 && (
              <span className="rounded-full bg-foreground/6 px-2 py-px text-xs/4 font-medium text-muted-foreground">{breakdown.notChecked} not checked</span>
            )}
          </button>
          {doneOpen && brief.done.items.length > 0 && (
            <div className="flex flex-col divide-y divide-foreground/6 border-t border-hairline bg-card">
              {brief.done.items.map(item => (
                <Link
                  key={item.id}
                  to="/work/items/$itemId"
                  params={{ itemId: item.id }}
                  className="flex items-center gap-2 px-3.5 py-2.5 outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ThreadAvatar id={item.ownerId} name={item.ownerName} size={16} />
                  <span className="min-w-0 flex-1 truncate text-[13px]/[18px] text-foreground">{item.title}</span>
                  <CheckBadge item={item} />
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
