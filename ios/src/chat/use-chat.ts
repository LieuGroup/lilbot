/** React hook binding a screen to a bot's live chat via the store-backed ChatSessionManager,
 *  so folding/unfolding between compact native stack screens and split panes keeps the session alive. */
import { useCallback, useEffect } from 'react'
import type { Attachment } from '../../../shared/attachment-schema'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { newMessageId, thisDeviceId } from '../devices/device'
import { ChatSessionManager, type ChatSessionSocket } from './session-manager'
import { emptySlot, updateChat, useChatStore } from './store'

const sessions = new ChatSessionManager({
  getSocket: () => ensureSocket() as ChatSessionSocket | null,
  getSlot: botId => useChatStore.getState().slots[botId] ?? emptySlot,
  updateSlot: updateChat,
  newMessageId,
  getDeviceId: thisDeviceId
})

sessions.setConnected(useConnectionStore.getState().connected)
useConnectionStore.subscribe(state => sessions.setConnected(state.connected))

/** Starts a new chat session for a bot from split-view chrome (e.g. unfolded Duo / iPad New chat orb). */
export function startNewChat(botId: string) {
  sessions.newChat(botId)
}

export function useChat(botId: string) {
  const connected = useConnectionStore(state => state.connected)
  const slot = useChatStore(state => state.slots[botId] ?? emptySlot)

  useEffect(() => {
    sessions.setConnected(connected)
    return sessions.acquire(botId)
  }, [botId, connected])

  const send = useCallback((text: string, attachments: Attachment[] = []) => sessions.send(botId, text, attachments), [botId])
  const stop = useCallback(() => sessions.stop(botId), [botId])
  const newChat = useCallback(() => sessions.newChat(botId), [botId])

  return { ...slot, send, stop, newChat }
}
