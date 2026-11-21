/** The rules every goal follows, whoever acts on it. Pure: no database, no engine. */
import type { Goal, GoalReview, GoalState, GoalTarget, GoalTargetInput } from '../../shared/goal-schema'
import { LilBotError } from '../../shared/lilbot-error'
import type { RoutineSchedule } from '../../shared/routine-schema'
import type { WorkSummary } from '../../shared/work-schema'
import { pointerOf } from '../work/work-rules'

/** The rhythm when neither the bot nor Oscar chose one. */
export const WEEKLY: RoutineSchedule = { kind: 'weekly', day: 1, time: '09:00', timeZone: 'Australia/Adelaide' }
const FINAL: GoalState[] = ['reached', 'dropped']
export const isFinalGoal = (state: GoalState) => FINAL.includes(state)

/** Today in Adelaide, as YYYY-MM-DD. */
export const today = (now: number) => new Date(now).toLocaleDateString('en-CA', { timeZone: 'Australia/Adelaide' })

/** Nothing is done for a goal before Oscar agrees, while it is paused or after it ended. */
export function requireAgreed<G extends Goal>(goal: G | null, botId: string): G {
  if (!goal || goal.botId !== botId) throw new LilBotError('goal_missing', 'No goal of yours has that id.')
  if (goal.state === 'proposed') throw new LilBotError('goal_not_agreed', 'Oscar has not agreed this goal yet: do nothing for it until he does.')
  if (goal.state !== 'agreed') throw new LilBotError('goal_not_agreed', `This goal is ${goal.state}: do nothing more for it.`)
  return goal
}

export function checkRhythm(review: RoutineSchedule, minSeconds: number) {
  if (review.kind === 'interval' && review.seconds < minSeconds) throw new LilBotError('goal_rhythm', `Reviews must be at least ${minSeconds} seconds apart.`)
}

/** The target as proposed: a number other than the baseline, a due date from today, and the baseline read from its source. */
export function targetOf(input: GoalTargetInput, libraryTitle: (itemId: string) => string | null, now: number): GoalTarget {
  if (input.value === input.baseline) throw new LilBotError('goal_target', 'The target must differ from the baseline: say where the number should get to.')
  if (Number.isNaN(Date.parse(input.due)) || input.due < today(now)) throw new LilBotError('goal_target', 'The due date (YYYY-MM-DD) must be today or later.')
  const evidence = pointerOf(input.evidence, libraryTitle, now)
  return { measure: input.measure, source: input.source, baseline: { value: input.baseline, at: now, evidence }, value: input.value, due: input.due }
}

/** Up (1) or down (-1) toward the target. */
const direction = (target: GoalTarget) => Math.sign(target.value - target.baseline.value)

/** How a new reading compares with the previous one and the target. Stalled: not met, and nothing moved toward the target in
 *  this and the previous review, or the due date passed. */
export function compare(target: GoalTarget, latest: GoalReview | null, value: number, now: number) {
  const previous = latest?.value ?? target.baseline.value
  const step = Math.sign(value - previous) * direction(target)
  const moved: GoalReview['moved'] = step > 0 ? 'toward' : step < 0 ? 'away' : 'none'
  const met = (value - target.value) * direction(target) >= 0
  const stalled = !met && (today(now) > target.due || (moved !== 'toward' && !!latest && latest.moved !== 'toward'))
  return { previous, moved, met, stalled }
}

/** The goal's work items, without its review items. */
export function workCounts(items: WorkSummary[]): GoalReview['work'] {
  const count = (statuses: string[]) => items.filter(item => statuses.includes(item.status)).length
  return { done: count(['done']), open: count(['open', 'working', 'checking']), needsOscar: count(['needs_oscar']), failed: count(['failed']) }
}
