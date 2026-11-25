/** Live routines hook (`routines.list` + `goals.list` + change pushes) with monotonic sequence guard,
 *  goal-owned routine mapping, and pause/resume/delete helpers. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Routine } from '../../../shared/routine-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'

export function useRoutines(botId: string) {
  const connected = useConnectionStore(state => state.connected)
  const [routines, setRoutines] = useState<Routine[] | null>(null)
  const [goalByRoutineId, setGoalByRoutineId] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    const seq = ++loadSeqRef.current
    try {
      const [nextRoutines, goals] = await Promise.all([
        socket.call('routines.list', { botId }),
        socket.call('goals.list', { botId }).catch(() => [])
      ])
      if (seq !== loadSeqRef.current) return
      const linked = Object.fromEntries(goals.flatMap(goal => (goal.routineId ? [[goal.routineId, goal.text]] : [])))
      setRoutines(nextRoutines)
      setGoalByRoutineId(linked)
      setError('')
    } catch (failure) {
      if (seq !== loadSeqRef.current) return
      setError(messageOf(failure))
    }
  }, [botId, connected])

  useEffect(() => {
    loadSeqRef.current += 1
    setRoutines(null)
    setGoalByRoutineId({})
    void load()
    const socket = ensureSocket()
    if (!socket) return
    const stopRoutines = socket.onRoutinesChanged(() => void load())
    const stopGoals = socket.onGoalsChanged(() => void load())
    return () => {
      stopRoutines()
      stopGoals()
    }
  }, [load])

  const togglePaused = useCallback(
    async (routine: Routine, paused: boolean) => {
      const socket = ensureSocket()
      if (!socket) return
      setRoutines(prev => prev?.map(r => (r.id === routine.id ? { ...r, paused } : r)) ?? null)
      try {
        await socket.call(paused ? 'routines.pause' : 'routines.resume', { botId, id: routine.id })
      } catch (failure) {
        setRoutines(prev => prev?.map(r => (r.id === routine.id ? { ...r, paused: !paused } : r)) ?? null)
        throw failure
      }
    },
    [botId]
  )

  const remove = useCallback(
    async (routineId: string) => {
      const socket = ensureSocket()
      if (!socket) return
      await socket.call('routines.delete', { botId, id: routineId })
      setRoutines(prev => prev?.filter(r => r.id !== routineId) ?? null)
    },
    [botId]
  )

  return { routines, goalByRoutineId, error, togglePaused, remove }
}
