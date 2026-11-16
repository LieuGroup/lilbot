/** Which bot's menu is open, and which dialog a menu item opened. The roster only writes here;
 *  the menu and its dialogs load on first use (`bot-menu.tsx`), so the first page stays small. */
import { create } from 'zustand'

/** An element, or a point (right-click) that the menu opens beside. */
export type MenuAnchor = Element | { getBoundingClientRect: () => DOMRect }

export type BotDialog = 'name-and-avatar' | 'new-section' | 'delete'

interface BotMenuState {
  /** The bot whose menu or dialog is showing. Kept after closing, so both can animate out. */
  botId: string | null
  anchor: MenuAnchor | null
  menuOpen: boolean
  dialog: BotDialog | null
  /** Set once the menu has been used, so its code is loaded and stays mounted. */
  used: boolean
  /** The last failed menu action, shown until the next one. */
  error: string
  /** When the menu last closed: a press on its own button closes it rather than reopening. */
  closedAt: number
}

export const useBotMenu = create<BotMenuState>(() => ({ botId: null, anchor: null, menuOpen: false, dialog: null, used: false, error: '', closedAt: 0 }))

export function openBotMenu(botId: string, anchor: MenuAnchor) {
  void loadBotMenu()
  const { botId: last, closedAt } = useBotMenu.getState()
  // Pressing the button of an open menu dismisses it on pointer-down; don't reopen on click.
  if (anchor instanceof Element && last === botId && Date.now() - closedAt < 300) return
  useBotMenu.setState({ botId, anchor, menuOpen: true, dialog: null, used: true, error: '' })
}

/** The point of a right-click, as something a menu can open beside. */
export function pointAnchor(x: number, y: number): MenuAnchor {
  return { getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 }) }
}

/** Fetch the menu's code early (on hover), so the first click opens it at once. */
export const loadBotMenu = () => import('./bot-menu')
