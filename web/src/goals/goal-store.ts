/** Live reads and Oscar's actions for Goals, refreshed on `goals.changed`, `work.changed` and reconnect. */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { Goal, GoalDetail } from '../../../shared/goal-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'

interface GoalStore {
  goals: Goal[]
  loaded: boolean
  byBot: Record<string, Goal[]>
  details: Record<string, GoalDetail>
  error: string
}

const useGoalStore = create<GoalStore>(() => ({
  goals: [],
  loaded: false,
  byBot: {},
  details: {},
  error: ''
}))

function subscribeGoals(load: () => Promise<void>, alsoWork = false) {
  void load()
  const offGoals = lilbot.onGoalsChanged(() => void load())
  const offWork = alsoWork ? lilbot.onWorkChanged(() => void load()) : null
  const offConn = lilbot.onConnection(connected => {
    if (connected) void load()
  })
  return () => {
    offGoals()
    offWork?.()
    offConn()
  }
}

export function useAllGoals() {
  useEffect(() => {
    const load = async () => {
      try {
        const goals = await lilbot.call('goals.list', {})
        useGoalStore.setState({ goals, loaded: true, error: '' })
      } catch (error) {
        useGoalStore.setState({ error: messageOf(error) })
      }
    }
    return subscribeGoals(load)
  }, [])
  const goals = useGoalStore(state => state.goals)
  const loaded = useGoalStore(state => state.loaded)
  const error = useGoalStore(state => state.error)
  return { goals, loaded, error }
}

export function useBotGoals(botId: string) {
  useEffect(() => {
    const load = async () => {
      try {
        const goals = await lilbot.call('goals.list', { botId })
        useGoalStore.setState(state => ({ byBot: { ...state.byBot, [botId]: goals } }))
      } catch {
        // Keep last read.
      }
    }
    return subscribeGoals(load)
  }, [botId])
  return useGoalStore(state => state.byBot[botId])
}

export function useGoalDetail(goalId: string) {
  useEffect(() => {
    const load = async () => {
      try {
        const detail = await lilbot.call('goals.open', { goalId })
        useGoalStore.setState(state => ({ details: { ...state.details, [goalId]: detail }, error: '' }))
      } catch (error) {
        useGoalStore.setState({ error: messageOf(error) })
      }
    }
    return subscribeGoals(load, true)
  }, [goalId])
  const goal = useGoalStore(state => state.details[goalId])
  const error = useGoalStore(state => state.error)
  return { goal, error }
}

function saveDetail(detail: GoalDetail) {
  useGoalStore.setState(state => ({
    details: { ...state.details, [detail.id]: detail },
    goals: state.goals.some(g => g.id === detail.id) ? state.goals.map(g => (g.id === detail.id ? detail : g)) : state.goals,
    byBot: state.byBot[detail.botId] ? { ...state.byBot, [detail.botId]: state.byBot[detail.botId].map(g => (g.id === detail.id ? detail : g)) } : state.byBot
  }))
  return detail
}

export const agreeGoal = async (goalId: string) => saveDetail(await lilbot.call('goals.agree', { goalId }))
export const adjustGoal = async (goalId: string, text: string) => saveDetail(await lilbot.call('goals.adjust', { goalId, text }))
export const pauseGoal = async (goalId: string) => saveDetail(await lilbot.call('goals.pause', { goalId }))
export const dropGoal = async (goalId: string, reason?: string) => saveDetail(await lilbot.call('goals.drop', { goalId, reason: reason?.trim() || undefined }))
