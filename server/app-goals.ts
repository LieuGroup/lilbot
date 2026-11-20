/** Builds goals and Oscar's two boards (work items and goals), after the exchanges the work board stops and answers through,
 *  and connects goals to the routine service, the activity line, the work board's notices and browsers. */
import type { EventFrame } from '../shared/protocol'
import type { ActivityService } from './activity/activity-service'
import type { BotStore } from './bots/bot-store'
import { GoalBoard } from './goals/goal-board'
import { GoalRoutines } from './goals/goal-routines'
import { GoalService } from './goals/goal-service'
import type { GoalStore } from './goals/goal-store'
import { type RoutineService, routineSettings } from './routines/routine-service'
import type { WorkAnswers } from './work/work-answers'
import { WorkBoard } from './work/work-board'
import type { WorkService } from './work/work-service'

interface GoalDeps {
  goalStore: GoalStore
  work: WorkService
  answers: WorkAnswers
  threads: ConstructorParameters<typeof WorkBoard>[2]
  routines: RoutineService
  activity: ActivityService
  store: BotStore
  publish: (frame: EventFrame) => void
  repeat: (name: string, interval: number, run: () => unknown) => unknown
}

export function createGoals({ goalStore, work, answers, threads, routines, activity, store, publish, repeat }: GoalDeps) {
  const board = new WorkBoard(work, answers, threads)
  const host = {
    waiting: (botId: string, goalId: string, key: string, on: boolean) => {
      if (store.exists(botId)) activity.observe({ botId, chatId: `goal:${goalId}`, key, status: on ? 'waiting' : 'finished' })
    },
    tell: (id: string, goal: { id: string; botId: string }, prompt: string) => answers.notify(id, goal.id, goal.botId, prompt),
    changed: () => publish({ event: 'goals.changed' })
  }
  const goals = new GoalService(goalStore, work, host, routineSettings(process.env).minIntervalSeconds)
  const reviews = new GoalRoutines(goals, routines)
  repeat('goals', 5000, () => reviews.tick())
  return { goals, boards: { work: board, goals: new GoalBoard(goals, reviews, (itemId, reason) => board.dropping(itemId, reason)) } }
}
