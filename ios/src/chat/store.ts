/** Each bot's chat as the app sees it, kept outside any one screen so the chat and the roster
 *  can all read it, and so it survives moving between screens. Mirrors the web app's store. */
import { create } from 'zustand'
import { type ChatView, emptyChat } from '../../../shared/client/chat/chat-state'

interface ChatSlot {
  view: ChatView
  /** The chat is open on the server and can take messages. */
  ready: boolean
  error: string
}

export const emptySlot: ChatSlot = { view: emptyChat, ready: false, error: '' }

interface ChatStore {
  slots: Record<string, ChatSlot>
  update: (botId: string, change: (slot: ChatSlot) => ChatSlot) => void
}

export const useChatStore = create<ChatStore>(set => ({
  slots: {},
  update: (botId, change) => set(state => ({ slots: { ...state.slots, [botId]: change(state.slots[botId] ?? emptySlot) } }))
}))

export const updateChat = (botId: string, change: (slot: ChatSlot) => ChatSlot) => useChatStore.getState().update(botId, change)
