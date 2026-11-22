/** Target progress card, summary tiles, Needs you, Work for this goal, and Reviews sections of a goal's page (Paper artboard 20, frame 9). */
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon, LoaderCircleIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import type { GoalDetail } from '../../../shared/goal-schema'
import { useRoutines } from '../routines/routine-store'
import { CheckBadge } from '../work/check-badge'
import { isOscarCheck } from '../work/work-lines'
import {
  daysLeftLabel,
  formatDueDate,
  formatGoalNumber,
  goalDeltaText,
  goalProgress,
  goalWorkStats,
  nextReviewLine,
  numberStatusText,
  orderedReviews,
  readingProvenance,
  reviewRowText
} from './goal-lines'

export function GoalSections({ goal, now }: { goal: GoalDetail; now: number }) {
  const [showAllWork, setShowAllWork] = useState(false)
  const routines = useRoutines(goal.botId)
  const stats = goalWorkStats(goal)
  const reviews = orderedReviews(goal.reviews)
  const current = goal.latest?.value ?? goal.target.baseline.value
  const pct = goalProgress(goal)
  const latestReviewItem = goal.latest ? stats.reviewItem(goal.latest.itemId) : undefined
  const visibleWork = showAllWork ? stats.workItems : stats.workItems.slice(0, 5)
  const nextRunAt = goal.routineId ? routines?.find(r => r.id === goal.routineId && !r.paused)?.nextRunAt : undefined

  return (
    <>
      <div className="flex flex-col gap-2.5 rounded-xl bg-background px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-2 text-xs/4 text-muted-foreground">
          <span>
            Target · {formatGoalNumber(goal.target.value)} {goal.target.measure} by {formatDueDate(goal.target.due, false, now)}
          </span>
          <span className="flex-none">{daysLeftLabel(goal.target.due, goal.state, now)}</span>
        </div>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[28px]/[34px] font-semibold tracking-[-0.02em] text-foreground">{formatGoalNumber(current)}</span>
          <span className="text-[13px]/[18px] text-muted-foreground">
            {goal.target.measure} · {goalDeltaText(goal)}
          </span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-foreground/8">
          <div className="h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between text-xs/4 text-muted-foreground">
          <span>Start {formatGoalNumber(goal.target.baseline.value)}</span>
          <span>Target {formatGoalNumber(goal.target.value)}</span>
        </div>
        <p className="text-xs/4 text-muted-foreground">{readingProvenance(goal, latestReviewItem, now)}</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 ring-1 ring-hairline">
          <span className="text-xs/4 text-muted-foreground">Did what it said</span>
          <span className="text-sm/5 font-medium text-foreground">
            {stats.done} of {stats.total} {stats.total === 1 ? 'item' : 'items'} done
          </span>
        </div>
        <div className="flex flex-col gap-0.5 rounded-xl px-3 py-2.5 ring-1 ring-hairline">
          <span className="text-xs/4 text-muted-foreground">The number</span>
          <span className="text-sm/5 font-medium text-foreground">{numberStatusText(goal)}</span>
        </div>
      </div>

      {stats.needsOscar.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="text-xs/4 text-muted-foreground">Needs you · {stats.needsOscar.length}</h2>
          {stats.needsOscar.map(item => {
            const oscarCheck = isOscarCheck(item)
            const label = oscarCheck
              ? item.checkLevel === 3
                ? `${item.title} · waits for your check`
                : item.question
                  ? `${item.title} · ${item.question}`
                  : item.title
              : item.question
                ? `${item.title}: ${item.question}`
                : item.title
            return (
              <div key={item.id} className="flex items-center gap-2 rounded-xl px-3 py-2.5 ring-1 ring-primary/35">
                <span className="min-w-0 flex-1 text-[13px]/[18px] text-foreground">{label}</span>
                <Link
                  to="/work/items/$itemId"
                  params={{ itemId: item.id }}
                  className="flex-none rounded-lg px-2.5 py-[5px] text-xs/4 font-medium text-foreground ring-1 ring-foreground/12 hover:bg-foreground/4"
                >
                  {oscarCheck ? 'Look' : 'Answer'}
                </Link>
              </div>
            )
          })}
        </section>
      )}

      {stats.workItems.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs/4 text-muted-foreground">Work for this goal · {stats.workItems.length}</h2>
            {stats.workItems.length > 5 && !showAllWork && (
              <button type="button" onClick={() => setShowAllWork(true)} className="text-xs/4 font-medium text-foreground hover:underline">
                All
              </button>
            )}
          </div>
          <div className="flex flex-col rounded-xl ring-1 ring-hairline">
            {visibleWork.map((item, index) => (
              <Fragment key={item.id}>
                {index > 0 && <div className="h-px bg-foreground/6" />}
                <Link
                  to="/work/items/$itemId"
                  params={{ itemId: item.id }}
                  className="flex items-center gap-2 px-3 py-[9px] outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {(item.status === 'working' || item.status === 'checking') && (
                    <LoaderCircleIcon className="size-3 flex-none animate-spin text-primary" strokeWidth={3} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px]/[18px] text-foreground">{item.title}</span>
                  <CheckBadge item={item} />
                  {!['done', 'checking'].includes(item.status) && !item.check?.state?.includes('not') && (
                    <span className="flex-none text-xs/4 text-muted-foreground">{item.status === 'needs_oscar' ? 'needs you' : item.status}</span>
                  )}
                </Link>
              </Fragment>
            ))}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-1.5">
        <h2 className="text-xs/4 text-muted-foreground">Reviews</h2>
        <div className="flex flex-col rounded-xl ring-1 ring-hairline">
          {reviews.map(({ review }, index) => (
            <Fragment key={review.itemId}>
              {index > 0 && <div className="h-px bg-foreground/6" />}
              <Link
                to="/work/goals/$goalId"
                params={{ goalId: goal.id }}
                search={{ review: review.itemId }}
                className="flex items-center gap-2 px-3 py-[9px] outline-none first:rounded-t-xl last:rounded-b-xl hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate text-[13px]/[18px] text-foreground">{reviewRowText(review, now)}</span>
                <CheckBadge item={stats.reviewItem(review.itemId)} />
                <ChevronRightIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={1.75} aria-hidden />
              </Link>
            </Fragment>
          ))}
          {goal.state === 'agreed' && (
            <>
              {reviews.length > 0 && <div className="h-px bg-foreground/6" />}
              <div className="px-3 py-[9px] text-[13px]/[18px] text-muted-foreground">{nextReviewLine(goal, nextRunAt, now)}</div>
            </>
          )}
          {reviews.length === 0 && goal.state !== 'agreed' && <div className="px-3 py-[9px] text-[13px]/[18px] text-muted-foreground">No reviews yet.</div>}
        </div>
      </section>
    </>
  )
}
