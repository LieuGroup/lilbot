/** React hook: the current chat with one bot. Opens or resumes it, follows its events, and
 *  reopens it after a reconnect so the transcript always comes from the server. */
import { useCallback, useEffect, useRef, useState } from 'react'

import { useBotStore } from '../bots/bot-store'
import { lebot, messageOf } from '../lebot-socket'
import { applyChatEvent, type ChatView, chatFromSnapshot, emptyChat, withError, withUserMessage } from './chat-state'

const REOPEN_DELAY_MS = 3000

const storageKey = (botId: string) => `lebot.chat.${botId}`

function readStoredChat(botId: string): string | null {
  try {
    return localStorage.getItem(storageKey(botId))
  } catch {
    return null
  }
}

function storeChat(botId: string, chatId: string | null) {
  try {
    if (chatId) localStorage.setItem(storageKey(botId), chatId)
    else localStorage.removeItem(storageKey(botId))
  } catch {
    // Private windows may refuse storage; the chat works, it just starts fresh after a reload.
  }
}

export function useChat(botId: string) {
  const connected = useBotStore(state => state.connected)
  const [chat, setChat] = useState<ChatView>(emptyChat)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  /** Bumped to open the chat again: after "New chat" or when the engine dropped it. */
  const [openCount, setOpenCount] = useState(0)
  const chatId = useRef('')

  useEffect(() => {
    if (!connected) {
      setReady(false)
      return
    }
    let cancelled = false
    let stopListening = () => {}
    let retry: ReturnType<typeof setTimeout> | undefined
    // Never show one bot's transcript under another bot's name while the new chat loads.
    setChat(current => (current.chatId && readStoredChat(botId) === current.chatId ? current : emptyChat))
    const reopenSoon = () => {
      retry = setTimeout(() => setOpenCount(count => count + 1), REOPEN_DELAY_MS)
    }

    lebot
      .call('chat.open', { botId, chatId: readStoredChat(botId) })
      .then(snapshot => {
        if (cancelled) {
          void lebot.call('chat.close', { chatId: snapshot.chatId }).catch(() => {})
          return
        }
        chatId.current = snapshot.chatId
        storeChat(botId, snapshot.chatId)
        setChat(chatFromSnapshot(snapshot))
        setError('')
        setReady(true)
        stopListening = lebot.onChat(snapshot.chatId, event => {
          setChat(current => applyChatEvent(current, event))
          if (event.type === 'closed') {
            setReady(false)
            reopenSoon()
          }
        })
      })
      .catch(failure => {
        if (cancelled) return
        // For example the engine is restarting: say so and keep trying, so the user need not reload.
        setError(messageOf(failure))
        reopenSoon()
      })

    return () => {
      cancelled = true
      clearTimeout(retry)
      stopListening()
      setReady(false)
      if (chatId.current && lebot.connected) void lebot.call('chat.close', { chatId: chatId.current }).catch(() => {})
      chatId.current = ''
    }
  }, [botId, connected, openCount])

  const send = useCallback(async (text: string) => {
    if (!chatId.current) return
    setChat(current => withUserMessage(current, text))
    try {
      await lebot.call('chat.send', { chatId: chatId.current, text })
    } catch (failure) {
      setChat(current => withError(current, `The message was not sent. ${messageOf(failure)}`))
    }
  }, [])

  const stop = useCallback(async () => {
    try {
      await lebot.call('chat.stop', { chatId: chatId.current })
    } catch (failure) {
      setChat(current => withError(current, `Could not stop the bot. ${messageOf(failure)}`))
    }
  }, [])

  const newChat = useCallback(() => {
    storeChat(botId, null)
    setChat(emptyChat)
    setOpenCount(count => count + 1)
  }, [botId])

  return { chat, ready, error, send, stop, newChat }
}
