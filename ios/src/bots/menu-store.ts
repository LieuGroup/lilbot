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
  /** True when a chat screen's `•••` opened the menu, so it also carries New bot and Search bots (#313). */
  menuFromChat: boolean
  /** Set by the chat menu's Search bots: the Bots root opens roster search once it is on screen, then clears it. */
  rosterSearchRequested: boolean
  dialog: BotDialogState | null
  error: string
  openNewBot: () => void
  closeNewBot: () => void
  openMenu: (botId: string) => void
  openChatMenu: (botId: string) => void
  closeMenu: () => void
  requestRosterSearch: () => void
  clearRosterSearchRequest: () => void
  openDialog: (dialog: BotDialogState) => void
  closeDialog: () => void
  closeBotOverlays: () => void
  setError: (message: string) => void
}

export const useBotMenuStore = create<BotMenuStore>(set => ({
  newBotOpen: false,
  menuBotId: null,
  menuFromChat: false,
  rosterSearchRequested: false,
  dialog: null,
  error: '',
  openNewBot: () => set({ newBotOpen: true, menuBotId: null, dialog: null }),
  closeNewBot: () => set({ newBotOpen: false }),
  openMenu: botId => set({ menuBotId: botId, menuFromChat: false, dialog: null, error: '' }),
  openChatMenu: botId => set({ menuBotId: botId, menuFromChat: true, dialog: null, error: '' }),
  closeMenu: () => set({ menuBotId: null }),
  requestRosterSearch: () => set({ rosterSearchRequested: true }),
  clearRosterSearchRequest: () => set({ rosterSearchRequested: false }),
  openDialog: dialog => set({ menuBotId: null, dialog }),
  closeDialog: () => set({ dialog: null }),
  closeBotOverlays: () => set({ menuBotId: null, dialog: null }),
  setError: error => set({ error })
}))
