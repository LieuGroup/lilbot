/** Each bot's routines (`routines.list`, with their newest 50 runs) and which of them review a goal (`goals.list`), kept
 *  fresh by `routines.changed` and `goals.changed` while the Activity tab, a routine or a run shows them. */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Routine } from '../../../shared/routine-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'

interface RoutineStore {
  byBot: Record<string, Routine[]>
  /** Per bot: the goal each review routine belongs to (routine id to Oscar's words for the goal). */
  goals: Record<string, Record<string, string>>
  /** Why the last read failed; the list read before it stays. */
  errors: Record<string, string>
}

export const useRoutineStore = create<RoutineStore>(() => ({ byBot: {}, goals: {}, errors: {} }))
const watching = new Map<string, number>()
let started = false

async function load(botId: string) {
  try {
    const [routines, goals] = await Promise.all([lilbot.call('routines.list', { botId }), lilbot.call('goals.list', { botId }).catch(() => [])])
    const linked = Object.fromEntries(goals.flatMap(goal => (goal.routineId ? [[goal.routineId, goal.text]] : [])))
    useRoutineStore.setState(state => ({
      byBot: { ...state.byBot, [botId]: routines },
      goals: { ...state.goals, [botId]: linked },
      errors: { ...state.errors, [botId]: '' }
    }))
  } catch (error) {
    useRoutineStore.setState(state => ({ errors: { ...state.errors, [botId]: messageOf(error) } }))
  }
}

const reload = () => {
  for (const botId of watching.keys()) void load(botId)
}

/** The bot's routines, oldest first; undefined until the first read. */
export function useRoutines(botId: string) {
  useEffect(() => {
    if (!started) {
      started = true
      lilbot.onRoutinesChanged(reload)
      lilbot.onGoalsChanged(reload)
      lilbot.onConnection(connected => {
        if (connected) reload()
      })
    }
    watching.set(botId, (watching.get(botId) ?? 0) + 1)
    if (watching.get(botId) === 1) void load(botId)
    return () => {
      const left = (watching.get(botId) ?? 1) - 1
      if (left > 0) watching.set(botId, left)
      else watching.delete(botId)
    }
  }, [botId])
  return useRoutineStore(state => state.byBot[botId])
}

/** Oscar's words for the goal this routine reviews, when it is a goal's review routine. */
export const useRoutineGoal = (botId: string, routineId: string) => useRoutineStore(state => state.goals[botId]?.[routineId])

/** Pauses or resumes a routine; the list shows the change at once and the server's answer settles it. */
export async function setPaused(botId: string, routine: Routine, paused: boolean) {
  const swap = (value: boolean) =>
    useRoutineStore.setState(state => ({
      byBot: { ...state.byBot, [botId]: (state.byBot[botId] ?? []).map(item => (item.id === routine.id ? { ...item, paused: value } : item)) }
    }))
  swap(paused)
  try {
    await lilbot.call(paused ? 'routines.pause' : 'routines.resume', { botId, id: routine.id })
  } catch (error) {
    swap(!paused)
    throw error
  } finally {
    void load(botId)
  }
}

export async function deleteRoutine(botId: string, id: string) {
  await lilbot.call('routines.delete', { botId, id })
  await load(botId)
}
