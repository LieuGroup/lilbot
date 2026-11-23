/** The conversation with one bot: opens the bot's main chat, follows its live events, and
 *  reopens it after a reconnect, so the transcript always comes from the server. Mirrors the
 *  web app's use-chat. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment } from '../../../shared/attachment-schema'
import { applyChatEvent, chatFromHistory, chatFromSnapshot, type UserItem, withError, withNewSession } from '../../../shared/client/chat/chat-state'
import { withSentMessage, withUserMessage } from '../../../shared/client/chat/user-messages'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { newMessageId, thisDeviceId } from '../devices/device'
import { emptySlot, updateChat, useChatStore } from './store'

const REOPEN_DELAY_MS = 3000

export function useChat(botId: string) {
  const connected = useConnectionStore(state => state.connected)
  const slot = useChatStore(state => state.slots[botId] ?? emptySlot)
  /** Bumped to open the chat again: for a new session, or when the engine dropped it. */
  const [openCount, setOpenCount] = useState(0)
  const startNew = useRef(false)
  const chatId = useRef('')

  // `openCount` is in the dependency list on purpose: changing it means "open again".
  useEffect(() => {
    const socket = ensureSocket()
    if (!socket || !connected) {
      updateChat(botId, current => ({ ...current, ready: false }))
      return
    }
    let cancelled = false
    let stopListening = () => {}
    let retry: ReturnType<typeof setTimeout> | undefined
    const reopenSoon = () => {
      retry = setTimeout(() => setOpenCount(count => count + 1), REOPEN_DELAY_MS)
    }

    const opening = startNew.current ? socket.call('chat.new', { botId }) : socket.call('chat.open', { botId })
    // Opening waits on the engine (about a second). The saved conversation is a local read, so a
    // chat this install has not shown yet appears at once and the snapshot replaces it.
    if (!startNew.current && (useChatStore.getState().slots[botId]?.view.load ?? 0) === 0) {
      socket
        .call('chat.history', { botId })
        .then(page => {
          if (!cancelled) updateChat(botId, current => (current.ready || current.view.load > 0 ? current : { ...current, view: chatFromHistory(page, current.view) }))
        })
        .catch(() => {})
    }
    startNew.current = false
    opening
      .then(snapshot => {
        if (cancelled) {
          void socket.call('chat.close', { chatId: snapshot.chatId }).catch(() => {})
          return
        }
        chatId.current = snapshot.chatId
        updateChat(botId, current => ({ ...current, view: chatFromSnapshot(snapshot, current.view), ready: true, error: '' }))
        stopListening = socket.onChat(snapshot.chatId, event => {
          updateChat(botId, current => ({ ...current, view: applyChatEvent(current.view, event), ready: event.type === 'closed' ? false : current.ready }))
          if (event.type === 'closed') reopenSoon()
        })
      })
      .catch(failure => {
        if (cancelled) return
        updateChat(botId, current => ({ ...current, error: messageOf(failure) }))
        reopenSoon()
      })

    return () => {
      cancelled = true
      clearTimeout(retry)
      stopListening()
      updateChat(botId, current => ({ ...current, ready: false }))
      if (chatId.current && socket.connected) void socket.call('chat.close', { chatId: chatId.current }).catch(() => {})
      chatId.current = ''
    }
  }, [botId, connected, openCount])

  /** Every message carries a new id, so the server's record of it fills in the same message on
   *  screen rather than adding another. It also says which device sent it. */
  const send = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      if (!chatId.current) return
      const messageId = newMessageId()
      const files = attachments.length > 0
      const item: UserItem = files ? { kind: 'user', text, messageId, attachments } : { kind: 'user', text, messageId }
      updateChat(botId, current => ({ ...current, view: withUserMessage(current.view, item) }))
      try {
        const socket = ensureSocket()
        if (!socket) return
        const sent = await socket.call('chat.send', {
          chatId: chatId.current,
          text,
          messageId,
          deviceId: await thisDeviceId(),
          ...(files ? { attachmentIds: attachments.map(file => file.id) } : {})
        })
        const message = sent.message
        if (message) updateChat(botId, current => ({ ...current, view: withSentMessage(current.view, message) }))
      } catch (failure) {
        updateChat(botId, current => ({ ...current, view: withError(current.view, `The message was not sent. ${messageOf(failure)}`) }))
      }
    },
    [botId]
  )

  const stop = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !chatId.current) return
    try {
      await socket.call('chat.stop', { chatId: chatId.current })
    } catch (failure) {
      updateChat(botId, current => ({ ...current, view: withError(current.view, `Could not stop the bot. ${messageOf(failure)}`) }))
    }
  }, [botId])

  /** Start a new session; it becomes this bot's main conversation on every device. */
  const newChat = useCallback(() => {
    startNew.current = true
    updateChat(botId, current => ({ ...current, view: withNewSession(current.view), ready: false }))
    setOpenCount(count => count + 1)
  }, [botId])

  return { ...slot, send, stop, newChat }
}
