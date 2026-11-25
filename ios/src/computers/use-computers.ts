/** Live Computers list (`computers.list` + `computers.changed`) and actions (`setMain`, `remove`). */
import { useCallback, useEffect, useState } from 'react'
import type { Computer } from '../../../shared/computer-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'

export function useComputers() {
  const connected = useConnectionStore(state => state.connected)
  const [computers, setComputers] = useState<Computer[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    try {
      setComputers(await socket.call('computers.list', {}))
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [connected])

  useEffect(() => {
    void load()
    const socket = ensureSocket()
    if (!socket) return
    return socket.onComputersChanged(() => void load())
  }, [load])

  const setMain = useCallback(async (computer: string | null) => {
    const socket = ensureSocket()
    if (!socket) return
    setError('')
    try {
      await socket.call('computers.setMain', { computer })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [])

  const remove = useCallback(async (computer: string) => {
    const socket = ensureSocket()
    if (!socket) return
    setError('')
    try {
      await socket.call('computers.remove', { computer })
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [])

  return { computers, error, setMain, remove }
}
