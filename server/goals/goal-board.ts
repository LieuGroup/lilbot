/** Oscar's side of goals: the list, one goal, and his answers (agree, adjust, pause, drop). Each decision is saved with its
 *  notice to the bot in one transaction; the review routine follows it (`GoalRoutines`, retried on its tick). */
import { type GoalEvent, goalMethods } from '../../shared/goal-schema'
import { LilBotError } from '../../shared/protocol'
import type { RoutineSchedule } from '../../shared/routine-schema'
import { backgroundFailure } from '../background'
import { isFinal, refuseUnsafe } from '../work/work-rules'
import { adjustedNotice, agreedNotice, changedNotice, droppedItemReason, droppedNotice, pausedNotice, resumedNotice } from './goal-prompts'
import type { GoalRoutines } from './goal-routines'
import { checkRhythm, isFinalGoal } from './goal-rules'
import type { GoalService } from './goal-service'
import type { GoalChange, StoredGoal } from './goal-store'

/** Drops a work item and the unfinished items below it inside the caller's transaction (`WorkBoard.dropping`); the returned
 *  function finishes the drop once it is committed. */
type DropItem = (itemId: string, reason: string) => () => Promise<void>
type Decision = { change: GoalChange; kind: GoalEvent['kind']; text: string | null; notice?: (goal: StoredGoal) => string; drops?: boolean }

export class GoalBoard {
  constructor(
    private goals: GoalService,
    private routines: GoalRoutines,
    private dropItem: DropItem,
    private now = Date.now
  ) {}

  list(raw: unknown) {
    const { botId, state } = goalMethods['goals.list'].parse(raw)
    return this.goals.store.list({ botId, state }).map(({ routineSeq, ...goal }) => goal)
  }
  open(goalId: string) {
    return this.goals.view(goalId)
  }

  /** A proposed goal starts, a paused one resumes, a proposed change applies (a proposal to drop drops it). `review` sets the
   *  rhythm instead of the bot's. */
  agree(goalId: string, review?: RoutineSchedule) {
    if (review) checkRhythm(review, this.goals.minIntervalSeconds)
    const proposal = this.goals.goal(goalId).proposal
    if (proposal?.drop) return this.drop(goalId, `Agreed to your proposal: ${proposal.why}`)
    return this.decide(goalId, goal => {
      if (isFinalGoal(goal.state) || (goal.state === 'agreed' && !goal.proposal)) throw new LilBotError('goal_nothing', 'Nothing about this goal waits for your agreement.')
      const p = goal.proposal
      const change: GoalChange = { state: 'agreed', proposal: null, oscar: null, review: review ?? p?.review ?? goal.review }
      if (p?.agreement) change.agreement = p.agreement
      if (p?.target) change.target = p.target
      if (goal.state === 'proposed') change.agreedAt = this.now()
      const notice = goal.state === 'proposed' ? agreedNotice : p ? changedNotice : resumedNotice
      return { change, kind: 'agreed', text: goal.state === 'proposed' ? null : p ? `The change: ${p.why}` : 'Resumed.', notice }
    })
  }

  /** Oscar answers in his own words instead; the bot proposes again (a new version, or a change to an agreed goal). */
  adjust(goalId: string, text: string) {
    refuseUnsafe([text])
    return this.decide(goalId, goal => {
      if (isFinalGoal(goal.state)) throw new LilBotError('goal_final', `This goal is ${goal.state}.`)
      return { change: { oscar: text, proposal: null }, kind: 'adjusted', text, notice: g => adjustedNotice(g, text) }
    })
  }

  pause(goalId: string) {
    return this.decide(goalId, goal => {
      if (goal.state !== 'agreed' && goal.state !== 'paused') throw new LilBotError('goal_not_agreed', 'Only an agreed goal can be paused.')
      return goal.state === 'paused' ? null : { change: { state: 'paused' }, kind: 'paused', text: null, notice: pausedNotice }
    })
  }

  /** Ends the goal: its review routine is removed and its unfinished work items are dropped like Oscar's own drop, which tells
   *  the bot about each; with none, the bot gets one notice. */
  drop(goalId: string, reason?: string) {
    refuseUnsafe([reason])
    return this.decide(goalId, goal => {
      if (goal.state === 'dropped') return null
      if (goal.state === 'reached') throw new LilBotError('goal_final', 'This goal is reached.')
      const change: GoalChange = { state: 'dropped', dropReason: reason ?? null, proposal: null, finishedAt: this.now() }
      return { change, kind: 'dropped', text: reason ?? null, notice: droppedNotice, drops: true }
    })
  }

  /** Saves Oscar's decision (null: nothing to change) with its notice, then lets the routine follow. */
  private async decide(goalId: string, decide: (goal: StoredGoal) => Decision | null) {
    const at = this.now()
    const saved = this.goals.store.db.transaction(() => {
      const goal = this.goals.goal(goalId)
      const decision = decide(goal)
      if (!decision) return null
      this.goals.store.update(goal.id, decision.change, at)
      const event = this.goals.store.log(goal.id, { at, by: 'oscar', kind: decision.kind, text: decision.text })
      const now = this.goals.goal(goal.id)
      const finish = decision.drops ? this.dropItems(now) : []
      if (decision.notice && !finish.length) this.goals.host.tell(`goal-${event}`, now, decision.notice(now))
      return { waited: goal.waitsForOscar, event, finish }
    })()
    if (!saved) return this.goals.view(goalId)
    this.goals.settle(saved.waited, this.goals.goal(goalId), saved.event)
    for (const finish of saved.finish) await finish().catch(() => backgroundFailure('goal drop'))
    await this.routines.reconcile(goalId).catch(() => backgroundFailure('goal routine'))
    return this.goals.view(goalId)
  }

  private dropItems(goal: StoredGoal) {
    const reason = droppedItemReason(goal)
    const items = this.goals.work.store.list({ goalId: goal.id, limit: 200 })
    return items.flatMap(({ id }) => (isFinal(this.goals.work.store.get(id)!.status) ? [] : [this.dropItem(id, reason)]))
  }
}
