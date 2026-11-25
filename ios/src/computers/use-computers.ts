/** Live Computers list (`computers.list` + `computers.changed`) and single-send guarded `setMain` / `remove`. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Computer } from '../../../shared/computer-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'

export function useComputers() {
  const connected = useConnectionStore(state => state.connected)
  const [computers, setComputers] = useState<Computer[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const busyRef = useRef<string | null>(null)
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    const seq = ++loadSeqRef.current
    try {
      const next = await socket.call('computers.list', {})
      if (seq !== loadSeqRef.current) return
      setComputers(next)
      setError('')
    } catch (failure) {
      if (seq !== loadSeqRef.current) return
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
    if (!socket || busyRef.current !== null) return
    const key = computer ?? '__clear__'
    busyRef.current = key
    setBusyId(key)
    setError('')
    try {
      await socket.call('computers.setMain', { computer })
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      busyRef.current = null
      setBusyId(null)
    }
  }, [])

  const remove = useCallback(async (computer: string) => {
    const socket = ensureSocket()
    if (!socket || busyRef.current !== null) return
    busyRef.current = computer
    setBusyId(computer)
    setError('')
    try {
      await socket.call('computers.remove', { computer })
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      busyRef.current = null
      setBusyId(null)
    }
  }, [])

  return { computers, error, busyId, setMain, remove }
}
