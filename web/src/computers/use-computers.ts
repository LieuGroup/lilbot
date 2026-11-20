import { useCallback, useEffect, useState } from 'react'
import type { Computer } from '../../../shared/computer-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'

/** The computers, read again after every `computers.changed` push and every reconnect. */
export function useComputers() {
  const connected = useBotStore(state => state.connected)
  const [computers, setComputers] = useState<Computer[] | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      setComputers(await lilbot.call('computers.list', {}))
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [])

  useEffect(() => {
    if (!connected) return
    void load()
    return lilbot.onComputersChanged(() => void load())
  }, [connected, load])

  return { computers, error, reload: load }
}
