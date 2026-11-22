/** A goal's page: header with Pause/Resume/Drop, pending agreement card, target progress, work and reviews (Paper artboard 20, frame 9). */
import { useNavigate, useParams, useRouter, useRouterState } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { messageOf } from '../app/lilbot-socket'
import { useNow } from '../app/use-now'
import { DropGoalDialog } from './drop-goal-dialog'
import { GoalAgreementCard } from './goal-agreement-card'
import { canResumeGoal, goalMetaLine, goalWorkStats, orderedReviews } from './goal-lines'
import { GoalReviewView } from './goal-review-view'
import { GoalSections } from './goal-sections'
import { agreeGoal, dropGoal, pauseGoal, useGoalDetail } from './goal-store'

export default function GoalPage() {
  const { goalId } = useParams({ from: '/work/goals/$goalId' })
  const reviewId = useRouterState({ select: state => (state.location.search as { review?: string }).review })
  const router = useRouter()
  const navigate = useNavigate()
  const now = useNow(60_000)
  const { goal, error } = useGoalDetail(goalId)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [dropping, setDropping] = useState(false)

  const goBack = () => {
    if (window.history.length > 1) router.history.back()
    else void navigate({ to: '/work/goals' })
  }

  if (!goal) {
    return (
      <div className="flex h-full flex-col">
        <header className="flex h-[52px] flex-none items-center justify-between border-b border-hairline px-5">
          <span className="text-sm/5 font-semibold">Goal</span>
          <button type="button" onClick={goBack} className="rounded-lg px-2.5 py-[5px] text-[13px]/[18px] font-medium ring-1 ring-foreground/12 hover:bg-foreground/4">
            Back
          </button>
        </header>
        <div className="mx-auto w-full max-w-[640px] px-5 py-5 text-[13px] text-muted-foreground">{error ? <Notice tone="error">{error}</Notice> : 'Loading goal...'}</div>
      </div>
    )
  }

  const stats = goalWorkStats(goal)
  const openedReview = reviewId ? orderedReviews(goal.reviews).find(entry => entry.review.itemId === reviewId) : undefined
  if (openedReview) {
    return (
      <GoalReviewView
        goal={goal}
        review={openedReview.review}
        reviewIndex={openedReview.index}
        reviewItem={stats.reviewItem(openedReview.review.itemId)}
        isLatest={openedReview.isLatest}
        now={now}
        onClose={() => void navigate({ to: '/work/goals/$goalId', params: { goalId }, search: {} })}
      />
    )
  }

  const final = goal.state === 'reached' || goal.state === 'dropped'
  const headerBtn =
    'rounded-lg px-2.5 py-[5px] text-[13px]/[18px] font-medium text-foreground ring-1 ring-foreground/12 outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring'

  async function togglePause() {
    if (!goal || busy) return
    if (goal.state === 'paused' && !canResumeGoal(goal)) return
    setBusy(true)
    setActionError('')
    try {
      if (goal.state === 'paused') await agreeGoal(goal.id)
      else await pauseGoal(goal.id)
    } catch (failure) {
      setActionError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between gap-3 border-b border-hairline pt-[env(safe-area-inset-top)] pr-3 pl-5">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm/5 font-semibold tracking-[-0.01em] text-foreground">{goal.text}</h1>
          <p className="truncate text-xs/4 text-muted-foreground">{goalMetaLine(goal, now)}</p>
        </div>
        <div className="flex flex-none items-center gap-1.5">
          {goal.state === 'agreed' && (
            <button type="button" disabled={busy} onClick={togglePause} className={headerBtn}>
              Pause
            </button>
          )}
          {canResumeGoal(goal) && (
            <Button disabled={busy} onClick={togglePause} className="h-[30px] rounded-lg px-2.5 text-[13px]/[18px] font-medium">
              Resume
            </Button>
          )}
          {!final && (
            <button type="button" disabled={busy} onClick={() => setDropping(true)} className={headerBtn}>
              Drop…
            </button>
          )}
          <button type="button" onClick={goBack} className={headerBtn}>
            Back
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[640px] flex-col gap-[18px] px-5 pt-[18px] pb-6">
          {(error || actionError) && <Notice tone="error">{actionError || error}</Notice>}
          {goal.waitsForOscar && <GoalAgreementCard goal={goal} now={now} />}
          {goal.state === 'proposed' && goal.oscar && (
            <div className="rounded-xl bg-background px-3.5 py-2.5 text-[13px]/5 text-muted-foreground">
              Your adjustment sent to {goal.botName}: “{goal.oscar}”
            </div>
          )}
          {goal.state === 'dropped' && goal.dropReason && (
            <div className="rounded-xl bg-background px-3.5 py-2.5 text-[13px]/5 text-muted-foreground">Dropped · “{goal.dropReason}”</div>
          )}
          <GoalSections goal={goal} now={now} />
        </div>
      </div>

      {dropping && (
        <DropGoalDialog
          text={goal.text}
          onConfirm={async reason => {
            await dropGoal(goal.id, reason)
            setDropping(false)
          }}
          onClose={() => setDropping(false)}
        />
      )}
    </div>
  )
}
