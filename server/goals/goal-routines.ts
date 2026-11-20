/** Each goal's review routine, made through the routine service: running while the goal is agreed, paused while it is paused,
 *  gone otherwise, always on the goal's rhythm. LilBot makes it on Oscar's agreement (`createdBy: oscar`: his agreement is the
 *  request), so it is not one of the five routines a bot may make for itself; one the bot paused or deleted with its own
 *  routine tools is put back on the next tick. The tick also marks a goal reached once a review that met the target was
 *  checked and done, never on the bot's number alone. */
import { LilBotError } from '../../shared/protocol'
import type { Routine } from '../../shared/routine-schema'
import { backgroundFailure } from '../background'
import type { RoutineService } from '../routines/routine-service'
import { reviewTask, targetLine } from './goal-prompts'
import type { GoalService } from './goal-service'
import type { StoredGoal } from './goal-store'

export class GoalRoutines {
  /** One change at a time per goal: Oscar's decisions and the tick never make or remove a routine side by side. */
  private queue = new Map<string, Promise<void>>()
  private ticking = false
  constructor(
    private goals: GoalService,
    private routines: RoutineService,
    private now = Date.now
  ) {}

  reconcile(goalId: string): Promise<void> {
    const next = (this.queue.get(goalId) ?? Promise.resolve()).then(() => this.apply(this.goals.goal(goalId)))
    this.queue.set(
      goalId,
      next.catch(() => {})
    )
    return next
  }

  async tick() {
    if (this.ticking) return
    this.ticking = true
    try {
      for (const goal of this.goals.store.withRoutines()) {
        this.reach(goal)
        await this.reconcile(goal.id).catch(() => backgroundFailure('goal routine'))
      }
    } finally {
      this.ticking = false
    }
  }

  private async apply(goal: StoredGoal) {
    const wanted = goal.state === 'agreed' || goal.state === 'paused'
    let routine = goal.routineId ? this.find(goal) : null
    if (goal.routineId && (!routine || !wanted || JSON.stringify(routine.schedule) !== JSON.stringify(goal.review))) {
      if (routine) await this.routines.delete(goal.botId, routine.id)
      routine = null
      this.goals.store.update(goal.id, { routineId: null }, this.now())
    }
    if (!wanted) return
    routine ??= await this.make(goal)
    if (routine.paused !== (goal.state === 'paused')) await this.routines.pause(goal.botId, routine.id, goal.state === 'paused')
  }

  /** Request ids are `goal-<id>-<n>`, so a retry after a crash finds the routine it made; a removed one gets the next number. */
  private async make(goal: StoredGoal): Promise<Routine> {
    for (let seq = goal.routineSeq; ; seq++) {
      if (seq !== goal.routineSeq) this.goals.store.update(goal.id, { routineSeq: seq }, this.now())
      try {
        const input = { requestId: `goal-${goal.id}-${seq}`, description: reviewTask(goal), schedule: goal.review, createdBy: 'oscar' as const }
        const routine = await this.routines.create(goal.botId, input)
        this.goals.store.update(goal.id, { routineId: routine.id }, this.now())
        return routine
      } catch (error) {
        if (!(error instanceof LilBotError && error.code === 'routine_deleted')) throw error
      }
    }
  }

  private find(goal: StoredGoal): Routine | null {
    try {
      return this.routines.store.get(goal.botId, goal.routineId!)
    } catch (error) {
      if (error instanceof LilBotError && error.code === 'routine_not_found') return null
      throw error
    }
  }

  /** Reached: the latest review met the target and its work item is done (checked at the kind's level). */
  private reach(goal: StoredGoal) {
    if (goal.state !== 'agreed' || !goal.latest?.met || this.goals.work.store.get(goal.latest.itemId)?.status !== 'done') return
    const at = this.now()
    const text = `${goal.latest.value}: ${targetLine(goal.target)}`
    const event = this.goals.store.db.transaction(() => {
      this.goals.store.update(goal.id, { state: 'reached', proposal: null, finishedAt: at }, at)
      return this.goals.store.log(goal.id, { at, by: 'lilbot', kind: 'reached', text })
    })()
    this.goals.settle(goal.waitsForOscar, this.goals.goal(goal.id), event)
  }
}
