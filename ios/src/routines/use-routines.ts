/** Live routines hook (`routines.list` + `routines.changed`) with pause/resume and delete helpers. */
import { useCallback, useEffect, useState } from 'react'
import type { Routine } from '../../../shared/routine-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'

export function useRoutines(botId: string) {
  const connected = useConnectionStore(state => state.connected)
  const [routines, setRoutines] = useState<Routine[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    try {
      setRoutines(await socket.call('routines.list', { botId }))
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [botId, connected])

  useEffect(() => {
    setRoutines(null)
    void load()
    const socket = ensureSocket()
    if (!socket) return
    return socket.onRoutinesChanged(() => void load())
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

  return { routines, error, togglePaused, remove }
}
