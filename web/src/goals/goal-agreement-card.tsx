/** "Goal agreement" (or proposed change) card in chat and on a goal's page (Paper artboard 20, frame 8). */
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/ui/button'
import { Notice } from '@/ui/notice'
import { Textarea } from '@/ui/textarea'
import type { Goal } from '../../../shared/goal-schema'
import { messageOf } from '../app/lilbot-socket'
import { dayLabel } from '../history/history-labels'
import { scheduleLabel } from '../routines/routine-lines'
import { ConfirmDropProposalDialog } from './drop-goal-dialog'
import { formatDueDate, formatGoalNumber, goalCardMode, shortDate } from './goal-lines'
import { adjustGoal, agreeGoal } from './goal-store'

function collapsedSubtitle(goal: Goal, now: number): string {
  const mode = goalCardMode(goal)
  if (mode === 'agreed' && goal.agreedAt) return `Agreed ${shortDate(goal.agreedAt, now)}`
  if (mode === 'dropped') return `Dropped ${shortDate(goal.finishedAt ?? goal.updatedAt, now)}`
  if (mode === 'reached') return `Reached ${shortDate(goal.finishedAt ?? goal.updatedAt, now)}`
  if (mode === 'paused') return `Paused ${shortDate(goal.updatedAt, now)}`
  return `Waiting for ${goal.botName}`
}

export function GoalAgreementCard({
  goal,
  now,
  showTitle = false,
  onAgreed,
  onDismiss
}: {
  goal: Goal
  now: number
  showTitle?: boolean
  onAgreed?: (goal: Goal) => void
  onDismiss?: () => void
}) {
  const [adjusting, setAdjusting] = useState(false)
  const [confirmingDrop, setConfirmingDrop] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  if (goalCardMode(goal) !== 'proposal') {
    return (
      <Link
        to="/work/goals/$goalId"
        params={{ goalId: goal.id }}
        className="flex items-center gap-2.5 rounded-xl px-4 py-3 ring-1 ring-hairline outline-none transition-colors hover:bg-foreground/4 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-[13px]/[18px] font-medium text-foreground">{goal.text}</span>
          <span className="text-xs/4 text-muted-foreground">{collapsedSubtitle(goal, now)}</span>
        </div>
        <ChevronRightIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={1.75} aria-hidden />
      </Link>
    )
  }

  const p = goal.proposal
  const showTarget = !p || !!p.target
  const showAgreement = !p || !!p.agreement
  const target = p?.target ?? goal.target
  const agreement = p?.agreement ?? goal.agreement
  const reviewText = p?.review ? scheduleLabel(p.review) : goal.reviewText

  async function agree() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const saved = await agreeGoal(goal.id)
      onAgreed?.(saved)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  async function submitAdjust(event: React.FormEvent) {
    event.preventDefault()
    if (!text.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await adjustGoal(goal.id, text.trim())
      setAdjusting(false)
      setText('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl px-4 py-3.5 ring-1 ring-foreground/12">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs/4 font-semibold text-foreground">{p ? 'Proposed change' : 'Goal agreement'}</span>
        <span className="text-xs/4 text-muted-foreground">Waiting for you</span>
      </div>

      {showTitle && <p className="text-sm/5 font-medium text-foreground">{goal.text}</p>}
      {p?.why && <p className="text-[13px]/5 text-foreground">{p.why}</p>}

      {p?.drop ? (
        <p className="text-sm/[21px] font-medium text-destructive">Proposes dropping this goal.</p>
      ) : (
        <>
          {showTarget && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs/4 text-muted-foreground">{p ? 'New target' : 'Target I propose'}</span>
              <span className="text-[15px]/[22px] font-medium text-foreground">
                {formatGoalNumber(target.value)} {target.measure} by {formatDueDate(target.due, true, now)}
              </span>
              <span className="text-xs/4 text-muted-foreground">
                Now {formatGoalNumber(target.baseline.value)} · read from {target.source} {dayLabel(target.baseline.at, now)} · I report {reviewText}
              </span>
            </div>
          )}
          {!showTarget && p?.review && (
            <div className="flex flex-col gap-0.5">
              <span className="text-xs/4 text-muted-foreground">New review rhythm</span>
              <p className="text-[13px]/5 text-foreground">{reviewText}</p>
            </div>
          )}
          {(showTarget || p?.review) && showAgreement && <div className="h-px bg-hairline" />}
          {showAgreement && (
            <>
              <AgreementList label="I can do alone" items={agreement.alone} />
              {agreement.needsOscar.length > 0 && <AgreementList label="I need from you" items={agreement.needsOscar} />}
              {agreement.cannotInfluence.length > 0 && <AgreementList label="I cannot influence" items={agreement.cannotInfluence} />}
            </>
          )}
        </>
      )}

      {!adjusting ? (
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Button onClick={p?.drop ? () => setConfirmingDrop(true) : agree} disabled={busy} className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium">
            {busy ? 'Saving...' : p?.drop ? 'Agree to drop' : 'Agree'}
          </Button>
          <Button variant="outline" onClick={() => setAdjusting(true)} disabled={busy} className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium">
            Adjust…
          </Button>
          {onDismiss && (
            <Button variant="ghost" onClick={onDismiss} disabled={busy} className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium text-muted-foreground">
              Not now
            </Button>
          )}
        </div>
      ) : (
        <form onSubmit={submitAdjust} className="flex flex-col gap-2 pt-0.5">
          <Textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Tell the bot what to change in this agreement"
            aria-label="Adjustment"
            rows={2}
            disabled={busy}
            autoFocus
            className="min-h-[60px] rounded-lg text-[13px]/5"
          />
          <div className="flex items-center gap-2">
            <Button type="submit" disabled={!text.trim() || busy} className="h-8 rounded-lg px-3.5 text-[13px]/[18px] font-medium">
              {busy ? 'Sending...' : 'Send adjustment'}
            </Button>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setAdjusting(false)} className="h-8 rounded-lg px-3 text-[13px]/[18px] font-medium">
              Cancel
            </Button>
          </div>
        </form>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {confirmingDrop && (
        <ConfirmDropProposalDialog
          text={goal.text}
          why={p?.why}
          onConfirm={async () => {
            const saved = await agreeGoal(goal.id)
            setConfirmingDrop(false)
            onAgreed?.(saved)
          }}
          onClose={() => setConfirmingDrop(false)}
        />
      )}
    </div>
  )
}

function AgreementList({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs/4 text-muted-foreground">{label}</span>
      <p className="text-[13px]/5 text-foreground">{items.join(' · ')}</p>
    </div>
  )
}
