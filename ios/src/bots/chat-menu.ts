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
