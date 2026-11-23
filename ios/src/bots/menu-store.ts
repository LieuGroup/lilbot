/** UI state for Roster bot management modals (new bot, bot menu, avatar, sections, delete). */
import { create } from 'zustand'

export type BotDialogState =
  | { kind: 'name-and-avatar'; botId: string }
  | { kind: 'move-section'; botId: string }
  | { kind: 'new-section'; botId: string }
  | { kind: 'change-primary'; botId: string }
  | { kind: 'delete'; botId: string }

interface BotMenuStore {
  newBotOpen: boolean
  menuBotId: string | null
  dialog: BotDialogState | null
  error: string
  openNewBot: () => void
  closeNewBot: () => void
  openMenu: (botId: string) => void
  closeMenu: () => void
  openDialog: (dialog: BotDialogState) => void
  closeDialog: () => void
  setError: (message: string) => void
}

export const useBotMenuStore = create<BotMenuStore>(set => ({
  newBotOpen: false,
  menuBotId: null,
  dialog: null,
  error: '',
  openNewBot: () => set({ newBotOpen: true, menuBotId: null, dialog: null }),
  closeNewBot: () => set({ newBotOpen: false }),
  openMenu: botId => set({ menuBotId: botId, dialog: null, error: '' }),
  closeMenu: () => set({ menuBotId: null }),
  openDialog: dialog => set({ menuBotId: null, dialog }),
  closeDialog: () => set({ dialog: null }),
  setError: error => set({ error })
}))
