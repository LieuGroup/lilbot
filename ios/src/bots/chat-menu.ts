/** Pure rules for the one menu a chat screen's `•••` opens (#313): the app actions on top, and how tall the sheet
 *  may be before it scrolls. Zero React Native runtime imports so unit tests verify them on Linux. */

export interface ChatMenuAppActionSpec {
  id: 'new-bot' | 'search-bots'
  label: string
}

/** New bot and Search bots, which no chat screen offers otherwise, sit above the bot's options. */
export const CHAT_MENU_APP_ACTIONS: readonly ChatMenuAppActionSpec[] = [
  { id: 'new-bot', label: 'New bot' },
  { id: 'search-bots', label: 'Search bots' }
]

/** The menu opened from a chat screen carries the app actions; the roster's long-press menu does not, because
 *  the roster already shows Search and New bot. */
export function menuAppActions(fromChat: boolean): readonly ChatMenuAppActionSpec[] {
  return fromChat ? CHAT_MENU_APP_ACTIONS : []
}

export interface MenuRowFrame {
  y: number
  height: number
}

/** Height for the scrolling sheet, or null when every row fits. When the rows are taller than `available`, the sheet
 *  stops halfway through the deepest row whose middle still fits, so about half of the next row shows at the edge
 *  and the rows above stay whole, at full strength. */
export function menuPeekHeight(rows: readonly MenuRowFrame[], available: number): number | null {
  const last = rows.at(-1)
  if (!last || last.y + last.height <= available) return null
  let peek: number | null = null
  for (const row of rows) {
    const middle = row.y + row.height / 2
    if (middle <= available) peek = middle
  }
  return peek ?? available
}

/** The landscape cap, the same as the app's other popover sheets (`ui/keyboard-sheet.ts`) and the R5 drawing. */
export const MENU_MAX_WIDTH_LANDSCAPE = 420
const MENU_EDGE = 12

export interface MenuSheetFrame {
  paddingLeft: number
  paddingRight: number
  maxWidth: number | undefined
}

/** Where the menu sheet sits across the window. Portrait is unchanged: full width inside 12 pt. In landscape (iPhone,
 *  folded or unfolded Duo) it stays clear of the side safe areas (Dynamic Island, Duo strip) and is at most 420 pt wide,
 *  centred in what is left. */
export function menuSheetFrame(input: { width: number; height: number; insetLeft: number; insetRight: number }): MenuSheetFrame {
  const paddingLeft = MENU_EDGE + Math.max(0, input.insetLeft)
  const paddingRight = MENU_EDGE + Math.max(0, input.insetRight)
  if (input.width <= input.height) return { paddingLeft, paddingRight, maxWidth: undefined }
  return { paddingLeft, paddingRight, maxWidth: Math.min(MENU_MAX_WIDTH_LANDSCAPE, Math.max(0, input.width - paddingLeft - paddingRight)) }
}
