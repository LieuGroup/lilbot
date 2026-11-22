/** Pure formatting and progress helpers for Goals screens (Paper artboard 20, frames 8-11). */
import type { Goal, GoalDetail, GoalReview, GoalTarget } from '../../../shared/goal-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { dayLabel } from '../history/history-labels'
import { whenNext } from '../routines/routine-lines'
import { checkerLabel } from '../work/work-lines'

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export function formatGoalNumber(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString('en-US') : value.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** "31 Jan" or "31 January" from YYYY-MM-DD (adding year if not the current year). */
export function formatDueDate(due: string, fullMonth = false, now = Date.now()): string {
  const [y, m, d] = due.split('-').map(Number)
  if (!y || !m || !d) return due
  const months = fullMonth ? MONTHS_FULL : MONTHS_SHORT
  const year = y === new Date(now).getFullYear() ? '' : ` ${y}`
  return `${d} ${months[m - 1]}${year}`
}

/** "20 Nov" from epoch ms. */
export function shortDate(at: number, now = Date.now()): string {
  const date = new Date(at)
  const year = date.getFullYear() === new Date(now).getFullYear() ? '' : ` ${date.getFullYear()}`
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}${year}`
}

/** Progress percentage (0 to 100) from baseline toward target; handles both increasing and decreasing targets. */
export function goalProgress(goal: Pick<Goal, 'target' | 'latest'>): number {
  const start = goal.target.baseline.value
  const end = goal.target.value
  const current = goal.latest?.value ?? start
  const span = end - start
  if (span === 0) return current === end ? 100 : 0
  const pct = ((current - start) / span) * 100
  return Math.max(0, Math.min(100, Math.round(pct)))
}

/** "up 90 from the start", "down 1.4 from the start", or "at the start". */
export function goalDeltaText(goal: Pick<Goal, 'target' | 'latest'>): string {
  if (!goal.latest) return 'from the start'
  const diff = goal.latest.value - goal.target.baseline.value
  if (diff === 0) return 'no change from the start'
  return `${diff > 0 ? 'up' : 'down'} ${formatGoalNumber(Math.abs(diff))} from the start`
}

/** "72 days left", "Due today", "3 days past due", or final state label. */
export function daysLeftLabel(due: string, state: Goal['state'], now = Date.now()): string {
  if (state === 'reached') return 'Reached'
  if (state === 'dropped') return 'Dropped'
  const [y, m, d] = due.split('-').map(Number)
  if (!y || !m || !d) return ''
  const targetDay = Date.UTC(y, m - 1, d)
  const today = new Date(now)
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const days = Math.round((targetDay - todayUtc) / 86_400_000)
  if (days === 0) return 'Due today'
  if (days === 1) return '1 day left'
  if (days > 1) return `${days} days left`
  return days === -1 ? '1 day past due' : `${Math.abs(days)} days past due`
}

/** Right-hand summary tile ("The number") on a goal's page. */
export function numberStatusText(goal: Pick<Goal, 'state' | 'latest'>): string {
  if (goal.state === 'reached') return 'Target reached'
  if (!goal.latest) return 'Waiting for first review'
  if (goal.latest.met) return 'Target met'
  if (goal.latest.stalled) return 'Stalled'
  if (goal.latest.moved === 'toward') return 'Moving toward target'
  if (goal.latest.moved === 'away') return 'Moving away'
  return 'Unchanged'
}

/** One review row on the Goal page: "Mon 23 Nov · 1,110, moving toward target" */
export function reviewRowText(review: GoalReview, now = Date.now()): string {
  const status = review.met ? 'target met' : review.stalled ? 'stalled' : review.moved === 'toward' ? 'moving toward target' : review.moved === 'away' ? 'moved away' : 'no change'
  return `${dayLabel(review.at, now)} · ${formatGoalNumber(review.value)}, ${status}`
}

/** Review report's "The number" line: "1,020 to 1,110 (+9%) · moving toward target." */
export function reviewNumberDetail(review: GoalReview, target: GoalTarget): string {
  const diff = review.value - review.previous
  const sign = diff > 0 ? '+' : diff < 0 ? '-' : ''
  const pct = review.previous !== 0 ? ` (${sign}${Math.round((Math.abs(diff) / Math.abs(review.previous)) * 100)}%)` : ''
  const movement = review.met
    ? 'Target met.'
    : review.stalled
      ? 'Stalled: nothing moved toward the target.'
      : review.moved === 'toward'
        ? 'Moved toward the target.'
        : review.moved === 'away'
          ? 'Moved away from the target.'
          : 'No change since the previous reading.'
  return `${formatGoalNumber(review.previous)} to ${formatGoalNumber(review.value)} ${target.measure}${pct}. ${movement}`
}

/** Non-review work items belonging to a goal, plus done/total/needsOscar counts. */
export function goalWorkStats(detail: Pick<GoalDetail, 'items' | 'reviews'>) {
  const reviewIds = new Set(detail.reviews.map(r => r.itemId))
  const workItems = detail.items.filter(item => !reviewIds.has(item.id))
  const done = workItems.filter(item => item.status === 'done').length
  const needsOscar = workItems.filter(item => item.status === 'needs_oscar')
  const byId = new Map<string, WorkSummary>(detail.items.map(item => [item.id, item]))
  return { workItems, done, total: workItems.length, needsOscar, reviewItem: (itemId: string) => byId.get(itemId) }
}

/** Footnote under the target card: names the source, date, and real verification status of the latest reading. */
export function readingProvenance(goal: Goal, reviewItem: WorkSummary | undefined, now = Date.now()): string {
  if (!goal.latest) return `Read from ${goal.target.source} on ${dayLabel(goal.target.baseline.at, now)}`
  const base = `Read from ${goal.target.source} on ${dayLabel(goal.latest.at, now)}`
  if (!reviewItem) return base
  if (reviewItem.status === 'checking') return `${base} · reading is being checked`
  if (reviewItem.check?.state === 'verified') return `${base} · verified by ${checkerLabel(reviewItem.check, reviewItem.ownerName)}`
  if (reviewItem.check?.state === 'passed') return `${base} · passed by you`
  if (reviewItem.check?.state === 'not_verified') return `${base} · not verified`
  if (reviewItem.check?.state === 'could_not_check') return `${base} · could not check`
  if (reviewItem.status === 'done' && reviewItem.checkLevel === 1) return `${base} · self-checked`
  return base
}

/** Header subtitle for a goal: "FillLight Bot · agreed 20 Nov · Mondays at 09:00" */
export function goalMetaLine(goal: Goal, now = Date.now()): string {
  const parts = [goal.botName]
  if (goal.state === 'proposed') parts.push(`proposed ${shortDate(goal.createdAt, now)}`)
  else if (goal.state === 'agreed' && goal.agreedAt) parts.push(`agreed ${shortDate(goal.agreedAt, now)}`)
  else if (goal.state === 'paused') parts.push(`paused ${shortDate(goal.updatedAt, now)}`)
  else if (goal.state === 'reached' && goal.finishedAt) parts.push(`reached ${shortDate(goal.finishedAt, now)}`)
  else if (goal.state === 'dropped' && goal.finishedAt) parts.push(`dropped ${shortDate(goal.finishedAt, now)}`)
  if (goal.state === 'agreed' || goal.state === 'proposed') parts.push(goal.reviewText)
  return parts.join(' · ')
}

export function sortGoals(goals: Goal[]) {
  const active = goals
    .filter(g => g.state === 'proposed' || g.state === 'agreed' || g.state === 'paused')
    .sort((a, b) => {
      if (a.waitsForOscar !== b.waitsForOscar) return a.waitsForOscar ? -1 : 1
      if (a.state === 'paused' && b.state !== 'paused') return 1
      if (b.state === 'paused' && a.state !== 'paused') return -1
      return b.updatedAt - a.updatedAt
    })
  const finished = goals.filter(g => g.state === 'reached' || g.state === 'dropped').sort((a, b) => b.updatedAt - a.updatedAt)
  return { active, finished }
}

/** A paused goal can only resume directly from the header when no proposal waits (otherwise `goals.agree` would apply/drop). */
export const canResumeGoal = (goal: Pick<Goal, 'state' | 'proposal'>) => goal.state === 'paused' && !goal.proposal

export type GoalCardMode = 'proposal' | 'agreed' | 'dropped' | 'reached' | 'paused' | 'waiting_bot'

/** Display mode for GoalAgreementCard: only active waiting proposals show Agree / Adjust buttons. */
export function goalCardMode(goal: Pick<Goal, 'state' | 'waitsForOscar'>): GoalCardMode {
  if (goal.waitsForOscar) return 'proposal'
  if (goal.state === 'agreed') return 'agreed'
  if (goal.state === 'dropped') return 'dropped'
  if (goal.state === 'reached') return 'reached'
  if (goal.state === 'paused') return 'paused'
  return 'waiting_bot'
}

export interface OrderedGoalReview {
  review: GoalReview
  /** 1-based chronological review number (oldest = 1, newest = reviews.length). */
  index: number
  isLatest: boolean
}

/** Server returns `goal.reviews` oldest-first (`ORDER BY id`); returns newest-first with chronological numbers and `isLatest`. */
export function orderedReviews(reviews: GoalReview[]): OrderedGoalReview[] {
  const last = reviews.length - 1
  return reviews.map((review, idx) => ({ review, index: idx + 1, isLatest: idx === last })).reverse()
}

/** Footer row under a goal's Reviews list: next scheduled review date from its routine, else the rhythm text. */
export function nextReviewLine(goal: Pick<Goal, 'review' | 'reviewText'>, nextRunAt: number | undefined, now = Date.now()): string {
  if (nextRunAt !== undefined) return `Next review ${whenNext(nextRunAt, now, goal.review.kind === 'interval')}`
  return `Reviews ${goal.reviewText}`
}
