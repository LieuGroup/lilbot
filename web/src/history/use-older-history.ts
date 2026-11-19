/** React hook: fetches the earlier parts of a bot's conversation, one at a time, as the reader
 *  scrolls up, and reads the earliest part again when the history import brings in more. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { lilbot } from '../app/lilbot-socket'
import { updateChat, useChatStore } from '../chat/chat-store'
import { canLoadOlder, olderRequest, withOlder } from './history-view'

/** While importing, the earliest part is read again at most this often. */
const REREAD_MS = 3000

export function useOlderHistory(botId: string, nearTop: () => boolean) {
  const [loading, setLoading] = useState(false)
  const busy = useRef(false)
  const lastReread = useRef(0)

  const load = useCallback(() => {
    const view = useChatStore.getState().slots[botId]?.view
    if (!view || busy.current || !canLoadOlder(view)) return
    if (view.older === null) {
      if (Date.now() - lastReread.current < REREAD_MS) return
      lastReread.current = Date.now()
    }
    const from = olderRequest(view)
    busy.current = true
    setLoading(true)
    lilbot
      .call('chat.history', from ? { botId, cursor: from } : { botId })
      .then(page => updateChat(botId, slot => ({ ...slot, view: withOlder(slot.view, page, from) })))
      .catch(failure => console.warn('LilBot: could not load earlier messages', failure))
      .finally(() => {
        busy.current = false
        setLoading(false)
      })
  }, [botId])

  useEffect(
    () =>
      lilbot.onHistoryChanged(changed => {
        if (changed === botId && nearTop()) load()
      }),
    [botId, load, nearTop]
  )

  return { loading, load }
}
