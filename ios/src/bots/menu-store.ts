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
  /** The menu opened from a strip with no room for the avatar, so it lists "Bot details" first. */
  menuWithDetails: boolean
  dialog: BotDialogState | null
  error: string
  openNewBot: () => void
  closeNewBot: () => void
  openMenu: (botId: string, options?: { withDetails?: boolean }) => void
  closeMenu: () => void
  openDialog: (dialog: BotDialogState) => void
  closeDialog: () => void
  closeBotOverlays: () => void
  setError: (message: string) => void
}

export const useBotMenuStore = create<BotMenuStore>(set => ({
  newBotOpen: false,
  menuBotId: null,
  menuWithDetails: false,
  dialog: null,
  error: '',
  openNewBot: () => set({ newBotOpen: true, menuBotId: null, menuWithDetails: false, dialog: null }),
  closeNewBot: () => set({ newBotOpen: false }),
  openMenu: (botId, options) => set({ menuBotId: botId, menuWithDetails: options?.withDetails ?? false, dialog: null, error: '' }),
  closeMenu: () => set({ menuBotId: null, menuWithDetails: false }),
  openDialog: dialog => set({ menuBotId: null, menuWithDetails: false, dialog }),
  closeDialog: () => set({ dialog: null }),
  closeBotOverlays: () => set({ menuBotId: null, menuWithDetails: false, dialog: null }),
  setError: error => set({ error })
}))
