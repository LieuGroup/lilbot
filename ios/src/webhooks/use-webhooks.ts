/** Live webhooks hook (`webhooks.list` + `webhooks.changed`) with monotonic sequence guard, pause/resume,
 *  delete, and clipboard-only secret address copy (never Share.share). */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Webhook } from '../../../shared/webhook-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { copyText } from '../ui/copy'

export function useWebhooks(botId: string) {
  const connected = useConnectionStore(state => state.connected)
  const [webhooks, setWebhooks] = useState<Webhook[] | null>(null)
  const [error, setError] = useState('')
  const loadSeqRef = useRef(0)

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    const seq = ++loadSeqRef.current
    try {
      const next = await socket.call('webhooks.list', { botId })
      if (seq !== loadSeqRef.current) return
      setWebhooks(next)
      setError('')
    } catch (failure) {
      if (seq !== loadSeqRef.current) return
      setError(messageOf(failure))
    }
  }, [botId, connected])

  useEffect(() => {
    loadSeqRef.current += 1
    setWebhooks(null)
    void load()
    const socket = ensureSocket()
    if (!socket) return
    return socket.onWebhooksChanged(() => void load())
  }, [load])

  const togglePaused = useCallback(
    async (webhook: Webhook, paused: boolean) => {
      const socket = ensureSocket()
      if (!socket) return
      setWebhooks(prev => prev?.map(w => (w.id === webhook.id ? { ...w, paused } : w)) ?? null)
      try {
        await socket.call(paused ? 'webhooks.pause' : 'webhooks.resume', { botId, id: webhook.id })
      } catch (failure) {
        setWebhooks(prev => prev?.map(w => (w.id === webhook.id ? { ...w, paused: !paused } : w)) ?? null)
        throw failure
      }
    },
    [botId]
  )

  const remove = useCallback(
    async (id: string) => {
      const socket = ensureSocket()
      if (!socket) return
      await socket.call('webhooks.delete', { botId, id })
      setWebhooks(prev => prev?.filter(w => w.id !== id) ?? null)
    },
    [botId]
  )

  const copyAddress = useCallback(
    async (id: string): Promise<'copied'> => {
      const socket = ensureSocket()
      if (!socket) throw new Error('Not connected.')
      const { address } = await socket.call('webhooks.address', { botId, id })
      const outcome = await copyText(address)
      if (outcome !== 'copied') throw new Error('Could not copy')
      return 'copied'
    },
    [botId]
  )

  return { webhooks, error, togglePaused, remove, copyAddress }
}
