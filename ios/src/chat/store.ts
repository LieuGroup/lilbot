/** Each bot's chat as the app sees it, kept outside any one screen so transcripts, unsent drafts,
 *  and scroll offsets survive folding, unfolding, and moving between native stack screens. */
import { create } from 'zustand'
import { type ChatView, emptyChat } from '../../../shared/client/chat/chat-state'

export interface ChatSlot {
  view: ChatView
  /** The chat is open on the server and can take messages. */
  ready: boolean
  error: string
  /** Unsent composer draft kept per bot so fold/unfold or bot switches never lose typed text. */
  draft: string
  /** Last FlatList contentOffset.y (inverted list: 0 is bottom/newest) so fold/unfold keeps reading position. */
  scrollOffset: number
}

export const emptySlot: ChatSlot = { view: emptyChat, ready: false, error: '', draft: '', scrollOffset: 0 }

interface ChatStore {
  slots: Record<string, ChatSlot>
  update: (botId: string, change: (slot: ChatSlot) => ChatSlot) => void
  setDraft: (botId: string, draft: string) => void
  setScrollOffset: (botId: string, offset: number) => void
}

export const useChatStore = create<ChatStore>(set => ({
  slots: {},
  update: (botId, change) => set(state => ({ slots: { ...state.slots, [botId]: change(state.slots[botId] ?? emptySlot) } })),
  setDraft: (botId, draft) =>
    set(state => {
      const current = state.slots[botId] ?? emptySlot
      if (current.draft === draft) return state
      return { slots: { ...state.slots, [botId]: { ...current, draft } } }
    }),
  setScrollOffset: (botId, offset) =>
    set(state => {
      const clamped = Math.max(0, offset)
      const current = state.slots[botId] ?? emptySlot
      if (clamped === 0 ? current.scrollOffset === 0 : Math.abs(current.scrollOffset - clamped) < 1) return state
      return { slots: { ...state.slots, [botId]: { ...current, scrollOffset: clamped } } }
    })
}))

export const updateChat = (botId: string, change: (slot: ChatSlot) => ChatSlot) => useChatStore.getState().update(botId, change)
