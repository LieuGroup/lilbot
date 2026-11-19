/** React hook: the conversation with one bot. The server decides which chat is the bot's main
 *  conversation, so every device sees the same one. This hook opens it, follows its events, and
 *  reopens it after a reconnect so the transcript always comes from the server. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Attachment } from '../../../shared/attachment-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { newMessageId } from '../attachments/attachment-rules'
import { useBotStore } from '../bots/bot-store'
import { applyChatEvent, chatFromHistory, chatFromSnapshot, emptyChat, type UserItem, withError, withSentMessage, withUserMessage } from './chat-state'
import { emptySlot, updateChat, useChatStore } from './chat-store'

const REOPEN_DELAY_MS = 3000

export function useChat(botId: string) {
  const connected = useBotStore(state => state.connected)
  const slot = useChatStore(state => state.slots[botId] ?? emptySlot)
  /** Bumped to open the chat again: for a new session, or when the engine dropped it. */
  const [openCount, setOpenCount] = useState(0)
  const startNew = useRef(false)
  const chatId = useRef('')

  // `openCount` is in the dependency list on purpose: changing it means "open again".
  useEffect(() => {
    if (!connected) {
      updateChat(botId, current => ({ ...current, ready: false }))
      return
    }
    let cancelled = false
    let stopListening = () => {}
    let retry: ReturnType<typeof setTimeout> | undefined
    const reopenSoon = () => {
      retry = setTimeout(() => setOpenCount(count => count + 1), REOPEN_DELAY_MS)
    }

    const opening = startNew.current ? lilbot.call('chat.new', { botId }) : lilbot.call('chat.open', { botId })
    // Opening waits on the engine (about a second). The saved conversation is a local read, so a
    // chat this page has not shown yet appears at once and the snapshot replaces it.
    if (!startNew.current && (useChatStore.getState().slots[botId]?.view.load ?? 0) === 0) {
      lilbot
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
          void lilbot.call('chat.close', { chatId: snapshot.chatId }).catch(() => {})
          return
        }
        chatId.current = snapshot.chatId
        updateChat(botId, current => ({ view: chatFromSnapshot(snapshot, current.view), ready: true, error: '' }))
        stopListening = lilbot.onChat(snapshot.chatId, event => {
          updateChat(botId, current => ({ ...current, view: applyChatEvent(current.view, event), ready: event.type === 'closed' ? false : current.ready }))
          if (event.type === 'closed') reopenSoon()
        })
      })
      .catch(failure => {
        if (cancelled) return
        // For example the engine is restarting: say so and keep trying, so the user need not reload.
        updateChat(botId, current => ({ ...current, error: messageOf(failure) }))
        reopenSoon()
      })

    return () => {
      cancelled = true
      clearTimeout(retry)
      stopListening()
      updateChat(botId, current => ({ ...current, ready: false }))
      if (chatId.current && lilbot.connected) void lilbot.call('chat.close', { chatId: chatId.current }).catch(() => {})
      chatId.current = ''
    }
  }, [botId, connected, openCount])

  /** A message with files carries a new id, so the server's record of it (the answer or the
   *  `user.message` event) fills in the same message on screen rather than adding another. */
  const send = useCallback(
    async (text: string, attachments: Attachment[] = []) => {
      if (!chatId.current) return
      const messageId = attachments.length > 0 ? newMessageId() : undefined
      const item: UserItem = messageId ? { kind: 'user', text, messageId, attachments } : { kind: 'user', text }
      updateChat(botId, current => ({ ...current, view: withUserMessage(current.view, item) }))
      try {
        const sent = await lilbot.call(
          'chat.send',
          messageId ? { chatId: chatId.current, text, attachmentIds: attachments.map(file => file.id), messageId } : { chatId: chatId.current, text }
        )
        const message = sent.message
        if (message) updateChat(botId, current => ({ ...current, view: withSentMessage(current.view, message) }))
      } catch (failure) {
        updateChat(botId, current => ({ ...current, view: withError(current.view, `The message was not sent. ${messageOf(failure)}`) }))
      }
    },
    [botId]
  )

  const stop = useCallback(async () => {
    try {
      await lilbot.call('chat.stop', { chatId: chatId.current })
    } catch (failure) {
      updateChat(botId, current => ({ ...current, view: withError(current.view, `Could not stop the bot. ${messageOf(failure)}`) }))
    }
  }, [botId])

  /** Start a new session; it becomes this bot's main conversation on every device. */
  const newChat = useCallback(() => {
    startNew.current = true
    updateChat(botId, current => ({ ...current, view: emptyChat, ready: false }))
    setOpenCount(count => count + 1)
  }, [botId])

  return { chat: slot.view, ready: slot.ready, error: slot.error, send, stop, newChat }
}
