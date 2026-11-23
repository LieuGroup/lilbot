/** Shared active-bot selection and compact-chat route flags across the Bots native stack
 *  (Roster/Split index and pushed compact Chat) and NativeTabs bar visibility. */
import { create } from 'zustand'
import type { Bot } from '../../../shared/bot-schema'

interface BotSelectionState {
  selectedId: string | null
  didAutoSelect: boolean
  chatInstances: number
  chatFocused: boolean
  select: (botId: string | null) => void
  clearIfSelected: (botId: string) => void
  enterChat: () => void
  leaveChat: () => void
  setChatFocused: (focused: boolean) => void
  autoSelectOnce: (bots: Bot[]) => { selectedId: string | null; justAutoSelected: boolean }
}

export const useBotSelection = create<BotSelectionState>((set, get) => ({
  selectedId: null,
  didAutoSelect: false,
  chatInstances: 0,
  chatFocused: false,
  select: botId => set({ selectedId: botId }),
  clearIfSelected: botId => set(state => (state.selectedId === botId ? { selectedId: null } : state)),
  enterChat: () => set(state => ({ chatInstances: state.chatInstances + 1 })),
  leaveChat: () => set(state => ({ chatInstances: Math.max(0, state.chatInstances - 1) })),
  setChatFocused: focused => set({ chatFocused: focused }),
  autoSelectOnce: bots => {
    const state = get()
    if (state.didAutoSelect || bots.length === 0) return { selectedId: state.selectedId, justAutoSelected: false }
    const primary = (bots.find(bot => bot.isPrimary) ?? bots[0]).id
    set({ selectedId: primary, didAutoSelect: true })
    return { selectedId: primary, justAutoSelected: true }
  }
}))
