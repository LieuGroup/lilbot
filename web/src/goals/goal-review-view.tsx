/** Review report view opened from a goal's Reviews list (Paper artboard 20, frame 10). */
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { Textarea } from '@/ui/textarea'
import type { GoalDetail, GoalReview } from '../../../shared/goal-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { messageOf } from '../app/lilbot-socket'
import { dayLabel } from '../history/history-labels'
import { CheckBadge } from '../work/check-badge'
import { formatDueDate, formatGoalNumber, reviewNumberDetail } from './goal-lines'
import { adjustGoal, agreeGoal } from './goal-store'

export function GoalReviewView({
  goal,
  review,
  reviewIndex,
  reviewItem,
  isLatest,
  now,
  onClose
}: {
  goal: GoalDetail
  review: GoalReview
  reviewIndex: number
  reviewItem: WorkSummary | undefined
  isLatest: boolean
  now: number
  onClose: () => void
}) {
  const [adjusting, setAdjusting] = useState(false)
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const proposal = isLatest ? goal.proposal : null
  const workTotal = review.work.done + review.work.open + review.work.needsOscar + review.work.failed

  async function agree() {
    setBusy(true)
    setError('')
    try {
      await agreeGoal(goal.id)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  async function sendAdjust(event: React.FormEvent) {
    event.preventDefault()
    if (!reply.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await adjustGoal(goal.id, reply.trim())
      setAdjusting(false)
      setReply('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-[calc(52px+env(safe-area-inset-top))] flex-none items-center justify-between gap-3 border-b border-hairline pt-[env(safe-area-inset-top)] pr-3 pl-5">
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate text-sm/5 font-semibold tracking-[-0.01em] text-foreground">Review · {dayLabel(review.at, now)}</h1>
          <p className="truncate text-xs/4 text-muted-foreground">
            {goal.text} · review {reviewIndex}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-none rounded-lg px-2.5 py-[5px] text-[13px]/[18px] font-medium text-foreground ring-1 ring-foreground/12 outline-none hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
        >
          Back
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[540px] flex-col gap-4 px-5 py-5">
          {reviewItem && (
            <div className="flex items-center justify-between gap-2">
              <CheckBadge item={reviewItem} />
              <Link to="/work/items/$itemId" params={{ itemId: review.itemId }} className="inline-flex items-center gap-0.5 text-xs/4 font-medium text-foreground hover:underline">
                View evidence and check <ChevronRightIcon className="size-3.5" strokeWidth={1.75} aria-hidden />
              </Link>
            </div>
          )}

          <section className="flex flex-col gap-0.5">
            <h2 className="text-xs/4 text-muted-foreground">I did what I said</h2>
            <p className="text-[13px]/5 whitespace-pre-wrap text-foreground">{review.did}</p>
            {workTotal > 0 && (
              <p className="text-xs/4 text-muted-foreground">
                {review.work.done} of {workTotal} items done{review.work.needsOscar > 0 ? ` · ${review.work.needsOscar} needs you` : ''}
                {review.work.failed > 0 ? ` · ${review.work.failed} failed` : ''}
              </p>
            )}
          </section>

          <section className="flex flex-col gap-0.5">
            <h2 className="text-xs/4 text-muted-foreground">The number</h2>
            <p className="text-[13px]/5 text-foreground">{reviewNumberDetail(review, goal.target)}</p>
          </section>

          {proposal && (
            <section className="flex flex-col gap-2.5 rounded-xl px-3.5 py-3 ring-1 ring-primary/35">
              <div className="flex flex-col gap-0.5">
                <h2 className="text-xs/4 text-muted-foreground">What I propose</h2>
                <p className="text-[13px]/5 text-foreground">{proposal.why}</p>
                {proposal.target && (
                  <p className="text-xs/4 text-muted-foreground">
                    New target: {formatGoalNumber(proposal.target.value)} {proposal.target.measure} by {formatDueDate(proposal.target.due, false, now)}
                  </p>
                )}
                {proposal.drop && <p className="text-xs/4 font-medium text-destructive">Drop this goal</p>}
              </div>
              {!adjusting ? (
                <div className="flex items-center gap-2">
                  <Button onClick={agree} disabled={busy} className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium">
                    {busy ? 'Saving...' : proposal.drop ? 'Agree to drop' : 'Agree'}
                  </Button>
                  <Button variant="outline" onClick={() => setAdjusting(true)} disabled={busy} className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium">
                    Reply…
                  </Button>
                </div>
              ) : (
                <form onSubmit={sendAdjust} className="flex flex-col gap-2">
                  <Textarea
                    value={reply}
                    onChange={e => setReply(e.target.value)}
                    placeholder="Reply with what to change"
                    aria-label="Reply to proposal"
                    rows={2}
                    disabled={busy}
                    autoFocus
                    className="min-h-[60px] rounded-lg text-[13px]/5"
                  />
                  <div className="flex items-center gap-2">
                    <Button type="submit" disabled={!reply.trim() || busy} className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium">
                      {busy ? 'Sending...' : 'Send'}
                    </Button>
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => setAdjusting(false)} className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium">
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
              {error && <Notice tone="error">{error}</Notice>}
            </section>
          )}

          <p className="text-xs/4 text-muted-foreground">
            A review is a work item too: it has the reading as evidence and appears on the board. When nothing moves, the proposal is to change the target or drop the goal.
          </p>
        </div>
      </div>
    </div>
  )
}
