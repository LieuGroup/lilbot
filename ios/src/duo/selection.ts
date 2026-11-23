/** Shared active-bot selection and ref-counted compact-chat route flags across the Bots native stack
 *  (Roster/Split index and pushed compact Chat) and NativeTabs bar visibility. */
import { create } from 'zustand'
import type { Bot } from '../../../shared/bot-schema'

interface BotSelectionState {
  selectedId: string | null
  didAutoSelect: boolean
  pendingInitialPush: boolean
  chatInstances: number
  chatFocusCount: number
  select: (botId: string | null) => void
  clearIfSelected: (botId: string) => void
  clearPendingInitialPush: () => void
  enterChat: () => void
  leaveChat: () => void
  focusChat: () => void
  blurChat: () => void
  autoSelectOnce: (bots: Bot[]) => string | null
}

export const useBotSelection = create<BotSelectionState>((set, get) => ({
  selectedId: null,
  didAutoSelect: false,
  pendingInitialPush: false,
  chatInstances: 0,
  chatFocusCount: 0,
  select: botId => set({ selectedId: botId, pendingInitialPush: false }),
  clearIfSelected: botId => set(state => (state.selectedId === botId ? { selectedId: null } : state)),
  clearPendingInitialPush: () => set(state => (state.pendingInitialPush ? { pendingInitialPush: false } : state)),
  enterChat: () => set(state => ({ chatInstances: state.chatInstances + 1 })),
  leaveChat: () => set(state => ({ chatInstances: Math.max(0, state.chatInstances - 1) })),
  focusChat: () => set(state => ({ chatFocusCount: state.chatFocusCount + 1 })),
  blurChat: () => set(state => ({ chatFocusCount: Math.max(0, state.chatFocusCount - 1) })),
  autoSelectOnce: bots => {
    const state = get()
    if (state.didAutoSelect || bots.length === 0) return state.selectedId
    const primary = (bots.find(bot => bot.isPrimary) ?? bots[0]).id
    set({ selectedId: primary, didAutoSelect: true, pendingInitialPush: true })
    return primary
  }
}))
