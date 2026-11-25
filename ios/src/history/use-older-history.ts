/** Fetches earlier conversation pages one at a time as the reader scrolls up in the inverted list,
 *  and rereads the earliest page when `history.changed` brings more imported rows. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { canLoadOlder, olderRequest, withOlder } from '../../../shared/client/chat/history-view'
import { updateChat, useChatStore } from '../chat/store'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'

const REREAD_MS = 3000

export function useOlderHistory(botId: string, nearOldest: { current: boolean }) {
  const connected = useConnectionStore(state => state.connected)
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)
  const lastReread = useRef(0)

  const load = useCallback(() => {
    const socket = ensureSocket()
    const view = useChatStore.getState().slots[botId]?.view
    if (!socket || !connected || !view || busy.current || !canLoadOlder(view)) return
    if (view.older === null) {
      if (Date.now() - lastReread.current < REREAD_MS) return
      lastReread.current = Date.now()
    }
    const from = olderRequest(view)
    busy.current = true
    setLoading(true)
    void socket
      .call('chat.history', from ? { botId, cursor: from } : { botId })
      .then(page => updateChat(botId, slot => ({ ...slot, view: withOlder(slot.view, page, from) })))
      .catch(() => {})
      .finally(() => {
        busy.current = false
        setLoading(false)
      })
  }, [botId, connected])

  useEffect(() => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    return socket.onHistoryChanged(changed => {
      if (changed === botId && nearOldest.current) load()
    })
  }, [botId, connected, load, nearOldest])

  return { loading, load }
}
