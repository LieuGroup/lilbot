/** The browser methods of Oscar's two boards: work items and goals. Each takes the board when called, so a session without
 *  one answers that it is unavailable. */
import type { Method } from '../../shared/protocol'
import type { GoalBoard } from '../goals/goal-board'
import type { WorkBoard } from '../work/work-board'
import type { Handlers } from './browser-session'

type BoardMethod = Extract<Method, `work.${string}` | `goals.${string}`>

export function boardHandlers(work: () => WorkBoard, goals: () => GoalBoard): Pick<Handlers, BoardMethod> {
  return {
    'work.list': async input => work().list(input),
    'work.open': async ({ itemId }) => work().open(itemId),
    'work.drop': async ({ itemId, reason }) => work().drop(itemId, reason),
    'work.answer': async ({ itemId, answer }) => work().answer(itemId, answer),
    'work.pass': async ({ itemId, note }) => work().pass(itemId, note),
    'work.sendBack': async ({ itemId, reason }) => work().sendBack(itemId, reason),
    'work.levels.get': async () => work().levels(),
    'work.levels.set': async input => work().setLevel(input),
    'work.brief': async ({ since }) => work().brief(since),
    'goals.list': async input => goals().list(input),
    'goals.open': async ({ goalId }) => goals().open(goalId),
    'goals.agree': ({ goalId, review }) => goals().agree(goalId, review),
    'goals.adjust': ({ goalId, text }) => goals().adjust(goalId, text),
    'goals.pause': ({ goalId }) => goals().pause(goalId),
    'goals.drop': ({ goalId, reason }) => goals().drop(goalId, reason)
  }
}
