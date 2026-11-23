/** Each bot's chat as the app sees it, kept outside any one screen so the chat and the roster
 *  can all read it, and so transcripts and unsent drafts survive folding, unfolding, and moving between screens. */
import { create } from 'zustand'
import { type ChatView, emptyChat } from '../../../shared/client/chat/chat-state'

export interface ChatSlot {
  view: ChatView
  /** The chat is open on the server and can take messages. */
  ready: boolean
  error: string
  /** Unsent composer draft kept per bot so fold/unfold or bot switches never lose typed text. */
  draft: string
}

export const emptySlot: ChatSlot = { view: emptyChat, ready: false, error: '', draft: '' }

interface ChatStore {
  slots: Record<string, ChatSlot>
  update: (botId: string, change: (slot: ChatSlot) => ChatSlot) => void
  setDraft: (botId: string, draft: string) => void
}

export const useChatStore = create<ChatStore>(set => ({
  slots: {},
  update: (botId, change) => set(state => ({ slots: { ...state.slots, [botId]: change(state.slots[botId] ?? emptySlot) } })),
  setDraft: (botId, draft) =>
    set(state => {
      const current = state.slots[botId] ?? emptySlot
      if (current.draft === draft) return state
      return { slots: { ...state.slots, [botId]: { ...current, draft } } }
    })
}))

export const updateChat = (botId: string, change: (slot: ChatSlot) => ChatSlot) => useChatStore.getState().update(botId, change)
