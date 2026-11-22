/** Live reads and Oscar's actions for Goals, refreshed on `goals.changed`, `work.changed` and reconnect. */
import { useEffect, useState } from 'react'
import { create } from 'zustand'
import type { Goal, GoalDetail } from '../../../shared/goal-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'

interface GoalStore {
  goals: Goal[]
  loaded: boolean
  byBot: Record<string, Goal[]>
  details: Record<string, GoalDetail>
}

const useGoalStore = create<GoalStore>(() => ({
  goals: [],
  loaded: false,
  byBot: {},
  details: {}
}))

function subscribeGoals(load: () => Promise<void>, alsoWork = false) {
  if (lilbot.connected) void load()
  const offGoals = lilbot.onGoalsChanged(() => {
    if (lilbot.connected) void load()
  })
  const offWork = alsoWork
    ? lilbot.onWorkChanged(() => {
        if (lilbot.connected) void load()
      })
    : null
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
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let seq = 0
    const load = async () => {
      const id = ++seq
      try {
        const goals = await lilbot.call('goals.list', {})
        if (!active || id !== seq) return
        useGoalStore.setState({ goals, loaded: true })
        setError('')
      } catch (failure) {
        if (active && id === seq) setError(messageOf(failure))
      }
    }
    const stop = subscribeGoals(load)
    return () => {
      active = false
      stop()
    }
  }, [])
  const goals = useGoalStore(state => state.goals)
  const loaded = useGoalStore(state => state.loaded)
  return { goals, loaded, error }
}

export function useBotGoals(botId: string) {
  useEffect(() => {
    let active = true
    let seq = 0
    const load = async () => {
      const id = ++seq
      try {
        const goals = await lilbot.call('goals.list', { botId })
        if (active && id === seq) useGoalStore.setState(state => ({ byBot: { ...state.byBot, [botId]: goals } }))
      } catch {
        // Keep last read.
      }
    }
    const stop = subscribeGoals(load)
    return () => {
      active = false
      stop()
    }
  }, [botId])
  return useGoalStore(state => state.byBot[botId])
}

export function useGoalDetail(goalId: string) {
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let seq = 0
    setError('')
    const load = async () => {
      const id = ++seq
      try {
        const detail = await lilbot.call('goals.open', { goalId })
        if (!active || id !== seq) return
        useGoalStore.setState(state => ({ details: { ...state.details, [goalId]: detail } }))
        setError('')
      } catch (failure) {
        if (active && id === seq) setError(messageOf(failure))
      }
    }
    const stop = subscribeGoals(load, true)
    return () => {
      active = false
      stop()
    }
  }, [goalId])
  const goal = useGoalStore(state => state.details[goalId])
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
