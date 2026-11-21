/** How the saved history's parts join the conversation on screen. Pure functions only.
 *  Rows from the history carry their stable `id` and time `at`; rows that arrived live have neither
 *  until the next load brings their saved copies. */
import type { HistoryItem, HistoryPage } from '../../../shared/history-schema'
import type { ChatView, ViewItem } from '../chat/chat-state'

/** The parts of `ChatView` that come from the history. */
type HistoryFields = Pick<ChatView, 'items' | 'first' | 'older' | 'oldestFrom' | 'start' | 'importing'>

const historyItems = (rows: readonly HistoryItem[]): ViewItem[] => rows.map(row => ({ ...row.item, id: row.id, at: row.at }))

/** A reloaded transcript keeps the objects of the items that did not change, so memoised rows
 *  are not drawn again. Items are compared by content; repeated identical items pair in order. */
export function reuseItems(previous: readonly ViewItem[], next: ViewItem[]): ViewItem[] {
  if (previous.length === 0) return next
  const earlier = new Map<string, ViewItem[]>()
  for (const item of previous) {
    const key = JSON.stringify(item)
    const same = earlier.get(key)
    if (same) same.push(item)
    else earlier.set(key, [item])
  }
  return next.map(item => earlier.get(JSON.stringify(item))?.shift() ?? item)
}

/** The latest part of the history, from opening or reopening the chat. Older parts already on
 *  screen stay, with their positions, when the new part continues them (they share a row);
 *  otherwise the view starts again from this part. Rows that arrived live are replaced. */
export function withLatest(previous: ChatView, page: HistoryPage): HistoryFields {
  const next = historyItems(page.items)
  const ids = new Set(next.map(item => item.id))
  const continues = previous.items.some(item => item.id !== undefined && ids.has(item.id))
  let kept = 0
  if (continues) while (kept < previous.items.length && previous.items[kept].id !== undefined && !ids.has(previous.items[kept].id)) kept++
  const items = [...previous.items.slice(0, kept), ...reuseItems(previous.items.slice(kept), next)]
  if (kept > 0) return { items, first: previous.first, older: previous.older, oldestFrom: previous.oldestFrom, start: previous.start, importing: previous.importing }
  return { items, first: previous.first, older: page.nextCursor, oldestFrom: null, start: page.start?.at ?? null, importing: !page.import.complete }
}

/** Whether an earlier part can be fetched: there is a cursor, or the import is still bringing
 *  older rows in and the oldest part should be read again. */
export const canLoadOlder = (chat: ChatView) => chat.older !== null || (chat.start === null && chat.importing && chat.items.some(item => item.id !== undefined))

/** The cursor to fetch with: the next older part, or the oldest part again while importing. */
export const olderRequest = (chat: ChatView) => chat.older ?? chat.oldestFrom

/** An earlier part arrived. Its rows go before what is on screen; rows already shown are skipped.
 *  A part fetched for a view that has since changed is ignored. */
export function withOlder(chat: ChatView, page: HistoryPage, from: string | null): ChatView {
  if (!canLoadOlder(chat) || olderRequest(chat) !== from) return chat
  const known = new Set(chat.items.flatMap(item => (item.id === undefined ? [] : [item.id])))
  const end = page.items.findIndex(row => known.has(row.id))
  // Read again while importing: only rows before the oldest one shown are new.
  if (chat.older === null && end < 0) return { ...chat, importing: !page.import.complete }
  const added = historyItems(page.items.slice(0, end < 0 ? page.items.length : end))
  return {
    ...chat,
    items: added.length > 0 ? [...added, ...chat.items] : chat.items,
    first: chat.first - added.length,
    older: page.nextCursor,
    oldestFrom: from,
    start: page.start?.at ?? null,
    importing: !page.import.complete
  }
}
