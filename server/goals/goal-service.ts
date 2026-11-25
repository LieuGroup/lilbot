/** What a bot does with goals, through LilBot's MCP server: propose one (from Oscar's words, in his conversation), propose a
 *  new version or a change, and report a review. The caller is always the authenticated bot. A review is a work item, made
 *  through the work board's own rules, so it is checked like any other number Oscar decides on. */
import { type Goal, type GoalDetail, GoalInput, type GoalProposal, GoalReadInput, type GoalReview } from '../../shared/goal-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { WorkReadInput } from '../../shared/work-schema'
import { evidenceTexts, refuseUnsafe } from '../work/work-rules'
import type { WorkService } from '../work/work-service'
import { reviewDone, reviewResult, reviewTitle } from './goal-prompts'
import { checkRhythm, compare, isFinalGoal, requireAgreed, targetOf, WEEKLY, workCounts } from './goal-rules'
import type { GoalChange, GoalStore, StoredGoal } from './goal-store'

interface GoalHost {
  /** While a goal waits for Oscar its bot shows as waiting and turns unread (unless he is viewing); `on` false ends it. */
  waiting(botId: string, goalId: string, key: string, on: boolean): void
  /** A notice for the goal's bot, delivered once as a hidden turn in its main conversation (`id` keeps it once). */
  tell(id: string, goal: Goal, prompt: string): void
  onWaiting?(goal: StoredGoal, event: number): void
  changed(): void
}

export class GoalService {
  constructor(
    readonly store: GoalStore,
    readonly work: WorkService,
    readonly host: GoalHost,
    readonly minIntervalSeconds: number,
    private now = Date.now
  ) {}

  goal(id: string): StoredGoal {
    const goal = this.store.get(id)
    if (!goal) throw new LilBotError('goal_missing', 'No goal has that id.')
    return goal
  }
  view(id: string): GoalDetail {
    const { routineSeq, ...goal } = this.goal(id)
    const reviews = this.store.reviews(id)
    return { ...goal, reviews, items: this.work.store.list({ goalId: id, limit: 200 }), events: this.store.events(id) }
  }

  /** The bot's read: its goals, every bot's (mine false), or one in full. */
  async read(callerId: string, raw: unknown) {
    const input = WorkReadInput.extend(GoalReadInput.shape).parse(raw)
    await this.work.host.requireBot(callerId)
    if (input.goalId) return this.view(input.goalId)
    return { goals: this.store.list({ botId: input.mine ? callerId : undefined }).map(({ routineSeq, ...goal }) => goal) }
  }

  async act(callerId: string, raw: GoalInput): Promise<GoalDetail> {
    const input = GoalInput.parse(raw)
    const caller = await this.work.host.requireBot(callerId)
    const target = input.target ? [input.target.measure, input.target.source, ...evidenceTexts(input.target.evidence)] : []
    refuseUnsafe([input.text, input.why, input.did, ...Object.values(input.agreement ?? {}).flat(), ...target])
    if (input.review) checkRhythm(input.review, this.minIntervalSeconds)
    if (input.action === 'progress') return this.progress(caller.id, input)
    if (!input.goalId) return this.propose(caller, input)
    const goal = this.goal(input.goalId)
    if (goal.botId !== caller.id) throw new LilBotError('goal_forbidden', 'Only the bot a goal belongs to proposes for it.')
    if (isFinalGoal(goal.state)) throw new LilBotError('goal_final', `This goal is ${goal.state}. Oscar gives new goals himself.`)
    if (input.text) throw new LilBotError('goal_text', "A goal's words are Oscar's: propose a new agreement or target instead.")
    if (this.store.logged(goal.id, input.requestId)) return this.view(goal.id)
    const event = this.store.db.transaction(() => (goal.state === 'proposed' ? this.revise(goal, input) : this.change(goal, input)))()
    this.settle(goal.waitsForOscar, this.goal(goal.id), event)
    return this.view(goal.id)
  }

  /** A new goal, in Oscar's words, from his conversation with the bot: nothing is done for it until he agrees. */
  private async propose(caller: { id: string; name: string }, input: GoalInput) {
    const prior = this.store.byRequest(caller.id, input.requestId)
    if (prior) return this.view(prior.id)
    if (!input.text || !input.agreement || !input.target) throw new LilBotError('goal_incomplete', "A new goal needs Oscar's words (text), the agreement and the target.")
    const chatId = await this.work.host.callingChat(caller.id, 'lilbot_goal', input.requestId)
    if (this.work.checks.isCheckChat(chatId) || this.work.host.session(caller.id, chatId).origin.kind !== 'conversation')
      throw new LilBotError('goal_not_oscars', "A goal is Oscar's: propose one only from his own words, in your conversation with him.")
    const at = this.now()
    const target = targetOf(input.target, id => this.work.host.libraryTitle(caller.id, id), at)
    const id = crypto.randomUUID()
    const event = this.store.db.transaction(() => {
      this.store.create({
        id,
        botId: caller.id,
        botName: caller.name,
        requestId: input.requestId,
        text: input.text!,
        agreement: input.agreement!,
        target,
        review: input.review ?? WEEKLY,
        at
      })
      return this.store.log(id, { at, by: 'bot', kind: 'proposed', text: input.text! }, input.requestId)
    })()
    this.settle(false, this.goal(id), event)
    return this.view(id)
  }

  /** A new version of a proposed goal, after Oscar adjusted it or on the bot's own second thought. */
  private revise(goal: StoredGoal, input: GoalInput) {
    const at = this.now()
    const change: GoalChange = { oscar: null }
    if (input.agreement) change.agreement = input.agreement
    if (input.target) change.target = targetOf(input.target, id => this.work.host.libraryTitle(goal.botId, id), at)
    if (input.review) change.review = input.review
    this.store.update(goal.id, change, at)
    return this.store.log(goal.id, { at, by: 'bot', kind: 'proposed', text: input.why ?? null }, input.requestId)
  }

  /** A change to an agreed or paused goal waits for Oscar; the goal carries on as agreed meanwhile. */
  private change(goal: StoredGoal, input: GoalInput) {
    if (!input.why) throw new LilBotError('goal_why', 'Say why the goal should change (why).')
    if (!input.agreement && !input.target && !input.review && !input.drop)
      throw new LilBotError('goal_change', 'Propose a new agreement, target or review rhythm, or dropping the goal (drop).')
    const at = this.now()
    const proposal: GoalProposal = {
      agreement: input.agreement ?? null,
      target: input.target ? targetOf(input.target, id => this.work.host.libraryTitle(goal.botId, id), at) : null,
      review: input.review ?? null,
      drop: !!input.drop,
      why: input.why,
      at
    }
    this.store.update(goal.id, { proposal }, at)
    return this.store.log(goal.id, { at, by: 'bot', kind: 'change', text: input.why }, input.requestId)
  }

  /** A review, only from a run of the goal's review routine, so reviews keep its rhythm: LilBot compares the reading with the
   *  previous one and the target, and the report becomes a work item with the reading as evidence (kind figure: a number Oscar
   *  decides on). A stalled goal needs a change or drop in the same call. */
  private async progress(callerId: string, input: GoalInput) {
    if (!input.goalId || input.value === undefined || !input.did || !input.evidence)
      throw new LilBotError('goal_progress', 'A review needs goalId, value (as you read it now), did and evidence of how you read it.')
    const goal = requireAgreed(this.store.get(input.goalId), callerId)
    if (this.store.reviewByRequest(goal.id, input.requestId)) return this.view(goal.id)
    const chatId = await this.work.host.callingChat(callerId, 'lilbot_goal', input.requestId)
    const session = this.work.host.session(callerId, chatId)
    if (session.origin.kind !== 'routine_run' || session.askedBy?.id !== goal.routineId)
      throw new LilBotError(
        'goal_review_session',
        "Reviews run only in the goal's review routine, on its rhythm. To tell Oscar where it stands now, read the measure and say so: that is not a review."
      )
    const at = this.now()
    const compared = compare(goal.target, goal.latest, input.value, at)
    const proposes = !!(input.agreement || input.target || input.review || input.drop)
    if (compared.stalled && !proposes && !goal.proposal)
      throw new LilBotError(
        'goal_stalled',
        'The number has not moved toward the target in two reviews, or the due date passed: propose a new target or dropping the goal in this call (target or drop, with why).'
      )
    const reviewed = new Set(this.store.reviews(goal.id).map(r => r.itemId))
    const work = workCounts(this.work.store.list({ goalId: goal.id, limit: 200 }).filter(item => !reviewed.has(item.id)))
    const review: Omit<GoalReview, 'itemId'> = { at, value: input.value, ...compared, did: input.did, work }
    const reading = { proves: `${goal.target.measure} for this review`, value: String(input.value), source: goal.target.source, readAt: new Date(at).toISOString() }
    const item = await this.work.actFrom(
      callerId,
      {
        requestId: input.requestId,
        title: reviewTitle(goal),
        kind: 'figure',
        done: reviewDone(goal),
        goalId: goal.id,
        evidence: [reading, ...input.evidence],
        status: 'done',
        result: reviewResult(goal, review)
      },
      chatId
    )
    const event = this.store.db.transaction(() => {
      if (!this.store.addReview(goal.id, input.requestId, { ...review, itemId: item.id })) return 0
      this.store.update(goal.id, {}, at)
      const logged = this.store.log(goal.id, { at, by: 'bot', kind: 'reviewed', text: `${input.value}: ${compared.met ? 'met' : compared.moved}` })
      return proposes ? this.change(this.goal(goal.id), { ...input, requestId: `${input.requestId}:change` }) : logged
    })()
    this.settle(goal.waitsForOscar, this.goal(goal.id), event)
    return this.view(goal.id)
  }

  /** A deleted bot's goals end; its review routines went with its routines. */
  forgetBot(botId: string) {
    const at = this.now()
    for (const goal of this.store.list({ botId }).filter(g => !isFinalGoal(g.state))) {
      this.store.update(goal.id, { state: 'dropped', dropReason: 'The bot was deleted.', proposal: null, routineId: null, finishedAt: at }, at)
      this.store.log(goal.id, { at, by: 'lilbot', kind: 'dropped', text: 'The bot was deleted.' })
    }
    this.host.changed()
  }

  /** Once a change is saved: the bot waits for Oscar while a proposal does, and the push to the screens. */
  settle(waited: boolean, goal: StoredGoal, event: number) {
    if (!waited && goal.waitsForOscar) {
      this.host.waiting(goal.botId, goal.id, `ask-${event}`, true)
      this.host.onWaiting?.(goal, event)
    }
    if (waited && !goal.waitsForOscar) this.host.waiting(goal.botId, goal.id, `end-${event}`, false)
    this.host.changed()
  }
}
