/** What LilBot tells a goal's bot (its review routine's task, Oscar's decisions as hidden turns) and the text of a review's work item. */
import type { Goal, GoalReview, GoalTarget } from '../../shared/goal-schema'

const named = (goal: Goal) => `goal ${goal.id} (${JSON.stringify(goal.text)})`
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10)
export const targetLine = (t: GoalTarget) => `${t.measure} from ${t.baseline.value} (${date(t.baseline.at)}) to ${t.value} by ${t.due}, read from ${t.source}`
const list = (items: string[]) => (items.length ? items.map(item => `- ${item}`).join('\n') : '- nothing')

/** The review routine's task. It names the goal and reads it live, so a changed target needs no new routine. */
export const reviewTask = (goal: Goal) =>
  `Review of your ${named(goal)}, which the owner agreed. 1. Read the goal with lilbot_work_list (goalId ${goal.id}): its target, agreement, reviews and work items. 2. Read the measure from its source yourself, now. 3. Report once with lilbot_goal (action progress, goalId ${goal.id}): value, did (what you did of what you said you would do alone, item by item), and evidence of how you read the value. LilBot compares the number with the target and records the review as a work item. If the number has not moved, or the due date passed, propose a new target or dropping the goal in the same call (target or drop, with why). Then carry on with the goal's work.`

export const agreedNotice = (goal: Goal) =>
  `The owner agreed your ${named(goal)}: ${targetLine(goal.target)}. LilBot made its review routine (${goal.reviewText}): reviews run only there, so report no progress from here, and never pause or delete it.\n\nYou said you would do alone:\n${list(goal.agreement.alone)}\n\nYou need from the owner:\n${list(goal.agreement.needsOscar)}\n\nStart now. Open a work item with lilbot_work (goalId ${goal.id}) for each thing you do alone, and work on it. For each thing you need from the owner, open one with status needs_oscar and exactly one question. Then tell the owner in one or two lines what you started.`

export const resumedNotice = (goal: Goal) => `The owner resumed your ${named(goal)}. Its review routine runs again (${goal.reviewText}). Carry on with its work items.`

export const changedNotice = (goal: Goal) =>
  `The owner agreed your proposed change to ${named(goal)}. Now: ${targetLine(goal.target)}; reviewed ${goal.reviewText}. Adjust its work items to match and carry on.`

export const adjustedNotice = (goal: Goal, text: string) =>
  goal.state === 'proposed'
    ? `The owner adjusted your proposed ${named(goal)}:\n\n${text}\n\nPropose again with lilbot_goal (action propose, goalId ${goal.id}): the agreement and target, read the baseline again. Do nothing else for it until the owner agrees.`
    : `The owner wants a change to your ${named(goal)}:\n\n${text}\n\nPropose the change with lilbot_goal (action propose, goalId ${goal.id}, with why), or say in one line why not. Keep working on the rest meanwhile.`

export const pausedNotice = (goal: Goal) =>
  `The owner paused your ${named(goal)}. Its review routine is paused. Start nothing new for it and report nothing on it until the owner resumes it; leave its work items as they are.`

export const droppedNotice = (goal: Goal) =>
  `The owner dropped your ${named(goal)}${goal.dropReason ? `, saying ${JSON.stringify(goal.dropReason)}` : ''}. Its review routine is removed. Stop all work for it and do not propose it again unless the owner asks.`

/** Why each unfinished work item of a dropped goal is dropped. */
export const droppedItemReason = (goal: Goal) => `The owner dropped the goal ${JSON.stringify(goal.text)}${goal.dropReason ? `: ${goal.dropReason}` : '.'}`

export const reviewTitle = (goal: Goal) => `Goal review: ${goal.text.length > 100 ? `${goal.text.slice(0, 99).trimEnd()}…` : goal.text}`
export const reviewDone = (goal: Goal) => `${goal.target.measure} read from ${goal.target.source} and compared with the target: ${targetLine(goal.target)}.`

/** "I did what I said" and "the number moved or did not", kept apart. */
export function reviewResult(goal: Goal, r: Omit<GoalReview, 'itemId'>) {
  const moved = r.met ? 'the target is met' : r.moved === 'none' ? 'it did not move' : r.moved === 'toward' ? 'it moved toward the target' : 'it moved away from the target'
  const number = `Number: ${goal.target.measure} is ${r.value} (previous ${r.previous}, baseline ${goal.target.baseline.value}, target ${goal.target.value} by ${goal.target.due}): ${moved}.`
  const items = `${r.work.done} done, ${r.work.open} under way, ${r.work.needsOscar} waiting for the owner, ${r.work.failed} failed`
  return `${number}${r.stalled ? ' Nothing moves: a change or dropping the goal is proposed.' : ''}\nWork: ${r.did} (items for the goal: ${items}).`
}
