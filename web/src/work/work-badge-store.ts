/** Lightweight count of work items and goals waiting for Oscar, for the "Work" entry in the sidebar and rail. */
import { useEffect } from 'react'
import { create } from 'zustand'
import { lilbot } from '../app/lilbot-socket'

interface WorkBadgeStore {
  count: number
  waitingGoalsByBot: Record<string, number>
}

const useWorkBadgeStore = create<WorkBadgeStore>(() => ({ count: 0, waitingGoalsByBot: {} }))

let started = false

async function refresh() {
  if (!lilbot.connected) return
  try {
    const [items, goals] = await Promise.all([lilbot.call('work.list', { status: ['needs_oscar'], limit: 200 }), lilbot.call('goals.list', {})])
    const waitingGoals = goals.filter(g => g.waitsForOscar)
    const waitingGoalsByBot: Record<string, number> = {}
    for (const g of waitingGoals) waitingGoalsByBot[g.botId] = (waitingGoalsByBot[g.botId] ?? 0) + 1
    useWorkBadgeStore.setState({ count: items.length + waitingGoals.length, waitingGoalsByBot })
  } catch {
    // Keep last known count on transient disconnect.
  }
}

function startBadgeWatch() {
  if (started) return
  started = true
  lilbot.onWorkChanged(() => void refresh())
  lilbot.onGoalsChanged(() => void refresh())
  lilbot.onConnection(connected => {
    if (connected) void refresh()
  })
  if (lilbot.connected) void refresh()
}

export function useNeedsYouCount(): number {
  useEffect(() => startBadgeWatch(), [])
  return useWorkBadgeStore(state => state.count)
}

/** True when this bot has at least one goal waiting for Oscar's agreement or change review. */
export function useHasWaitingGoal(botId: string): boolean {
  useEffect(() => startBadgeWatch(), [])
  return useWorkBadgeStore(state => (state.waitingGoalsByBot[botId] ?? 0) > 0)
}
