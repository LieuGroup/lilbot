/** Each bot's chat as the app sees it, kept outside any one screen so transcripts, unsent drafts,
 *  and exact scroll anchors survive folding, unfolding, and moving between native stack screens. */
import { create } from 'zustand'
import { type ChatView, emptyChat } from '../../../shared/client/chat/chat-state'
import type { ScrollAnchor } from './scroll-restore'

export interface ChatSlot {
  view: ChatView
  /** The chat is open on the server and can take messages. */
  ready: boolean
  error: string
  /** Unsent composer draft kept per bot so fold/unfold or bot switches never lose typed text. */
  draft: string
  /** Last FlatList contentOffset.y (inverted list: 0 is bottom/newest). */
  scrollOffset: number
  /** Exact anchored row key + offset within that row for deep-history and fold/unfold restore. */
  scrollAnchor: ScrollAnchor | null
}

export const emptySlot: ChatSlot = { view: emptyChat, ready: false, error: '', draft: '', scrollOffset: 0, scrollAnchor: null }

// Non-reactive per-bot measured row heights (capped to bound memory) so FlatList `onLayout` never triggers re-renders.
export const MAX_MEASURED_HEIGHTS = 500
const measuredHeights = new Map<string, Map<string, number>>()

export function recordRowHeight(botId: string, key: string, height: number) {
  if (!Number.isFinite(height) || height <= 0) return
  let map = measuredHeights.get(botId)
  if (!map) {
    map = new Map<string, number>()
    measuredHeights.set(botId, map)
  }
  const existing = map.get(key)
  if (existing !== undefined && Math.abs(existing - height) < 0.01) return
  if (existing !== undefined) map.delete(key)
  map.set(key, height)
  while (map.size > MAX_MEASURED_HEIGHTS) {
    const oldest = map.keys().next().value
    if (oldest === undefined) break
    map.delete(oldest)
  }
}

export function clearRowHeights(botId: string) {
  measuredHeights.delete(botId)
}

export function getRowHeights(botId: string): Readonly<Record<string, number>> {
  const map = measuredHeights.get(botId)
  if (!map) return {}
  return Object.fromEntries(map)
}

interface ChatStore {
  slots: Record<string, ChatSlot>
  update: (botId: string, change: (slot: ChatSlot) => ChatSlot) => void
  setDraft: (botId: string, draft: string) => void
  setScrollOffset: (botId: string, offset: number, anchor?: ScrollAnchor | null) => void
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
  setScrollOffset: (botId, offset, anchor) =>
    set(state => {
      const clamped = Math.max(0, offset)
      const current = state.slots[botId] ?? emptySlot
      const nextAnchor = anchor !== undefined ? anchor : clamped <= 2 ? null : current.scrollAnchor
      const sameOffset = clamped === 0 ? current.scrollOffset === 0 : Math.abs(current.scrollOffset - clamped) < 1
      const sameAnchor =
        current.scrollAnchor === nextAnchor ||
        (current.scrollAnchor !== null &&
          nextAnchor !== null &&
          current.scrollAnchor.key === nextAnchor.key &&
          Math.abs(current.scrollAnchor.offsetWithinRow - nextAnchor.offsetWithinRow) < 1 &&
          current.scrollAnchor.viewportWidth === nextAnchor.viewportWidth)
      if (sameOffset && sameAnchor) return state
      return { slots: { ...state.slots, [botId]: { ...current, scrollOffset: clamped, scrollAnchor: nextAnchor } } }
    })
}))

export const updateChat = (botId: string, change: (slot: ChatSlot) => ChatSlot) => useChatStore.getState().update(botId, change)
