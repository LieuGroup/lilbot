/** Goals over the real work board fixture (`workFixture`): the real goal service, Oscar's goal board, the real routine service
 *  over the same database, and the review routines' reconciler. Notices go through the work board's real delivery. */
import { GoalBoard } from '../../server/goals/goal-board'
import { GoalRoutines } from '../../server/goals/goal-routines'
import { GoalService } from '../../server/goals/goal-service'
import { RoutineService } from '../../server/routines/routine-service'
import type { CallingChats } from '../../server/threads/calling-chats'
import { LilBotError } from '../../shared/protocol'
import { workFixture } from '../work/work-fixture'

export const DUE = '2099-01-01'
/** How a bot reads the baseline of the fixture's goal. */
export const wcProof = (output: string) => ({ proves: 'notes.txt line count', command: 'wc -l /w/a/notes.txt', output })

/** `calls`: the goal calls are matched to the starts the fixture reports, as the server does (`state.chats` says where). */
export function goalFixture(options: { calls?: CallingChats } = {}) {
  const w = workFixture(options)
  const act = (input: Parameters<GoalService['act']>[1]) => {
    options.calls?.saw('a', w.state.chats.get('a') ?? 'a-main', 'mcp__lilbot_system__lilbot_goal', input, crypto.randomUUID())
    return goals.act('a', input)
  }
  // Routine runs join the bots table; the fixture's bots are only in its `requireBot`.
  for (const id of ['a', 'b', 'c'])
    w.database.query("INSERT INTO bots(id, name, function, instructions, engine_id, engine_bot_id) VALUES (?, ?, '', '', 'test', ?)").run(id, id.toUpperCase(), id)
  const g = { waits: [] as { botId: string; goalId: string; key: string; on: boolean }[], pushes: 0 }
  const routineHost = {
    requireBot: (id: string) => w.work.host.requireBot(id),
    runRoutine: async () => ({ status: 'completed' as const, text: '' }),
    openChat: async () => {
      throw new LilBotError('unavailable', 'No chats here.')
    }
  }
  const routines = new RoutineService(w.routineStore, routineHost, () => {}, { minIntervalSeconds: 60, selfCreatedCap: 5 })
  const goals = new GoalService(
    w.goalStore,
    w.work,
    {
      waiting: (botId, goalId, key, on) => g.waits.push({ botId, goalId, key, on }),
      tell: (id, goal, prompt) => w.answers.notify(id, goal.id, goal.botId, prompt),
      changed: () => g.pushes++
    },
    60
  )
  const reviews = new GoalRoutines(goals, routines)
  const board = new GoalBoard(goals, reviews, (itemId, reason) => w.board.dropping(itemId, reason))
  /** Oscar's goal for bot `a`, proposed in its main conversation: notes.txt from 3 lines to 10. */
  const propose = (extra: Record<string, unknown> = {}) =>
    act({
      action: 'propose',
      requestId: crypto.randomUUID(),
      text: 'Grow notes.txt to 10 lines',
      agreement: { alone: ['Write a line a day'], needsOscar: ['Ideas for the lines'], cannotInfluence: [] },
      target: { measure: 'lines in notes.txt', source: '/w/a/notes.txt', baseline: 3, evidence: wcProof('3 /w/a/notes.txt'), value: 10, due: DUE },
      review: { kind: 'interval', seconds: 600 },
      ...extra
    })
  /** Bot a's next calls come from a run of the goal's review routine, where reviews are taken. */
  const inReview = (goalId: string) => {
    const routineId = goals.goal(goalId).routineId
    w.routineStore.claimDue(Date.now() + 10 ** 12)
    const run = w.routineStore.pending().find(r => r.routineId === routineId)
    if (!run) return
    w.routineStore.attach(run.id, `review-${run.id}`, Date.now())
    w.state.chats.set('a', `review-${run.id}`)
  }
  const progress = (goalId: string, value: number, extra: Record<string, unknown> = {}) => {
    inReview(goalId)
    return act({
      action: 'progress',
      requestId: crypto.randomUUID(),
      goalId,
      value,
      did: 'Wrote the lines I said',
      evidence: [wcProof(`${value} /w/a/notes.txt`)],
      ...extra
    })
  }
  /** The notices waiting for delivery, oldest first. */
  const notices = () =>
    w.database.query("SELECT id, item_id AS about, bot_id AS botId, chat_id AS chatId, text FROM work_answers WHERE id LIKE 'goal-%' ORDER BY rowid").all() as any[]
  return { ...w, g, routines, goals, reviews, goalBoard: board, propose, progress, notices }
}
