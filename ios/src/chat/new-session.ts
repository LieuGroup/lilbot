/** Pure helpers for starting a new chat session on iOS: instant timestamped divider, empty-session
 *  snapshot guarantee, and synchronous double-tap guard. Zero React Native runtime imports. */
import type { ChatSnapshot } from '../../../shared/chat-schema'
import { type ChatView, chatFromSnapshot, withNewSession } from '../../../shared/client/chat/chat-state'
import type { ChatSlot } from './store'

/** Guard against rapid double-taps or taps while a new session is already opening. */
export function canTriggerNewSession(state: { connected: boolean; ready: boolean; opening: boolean; chatId: string }): boolean {
  return Boolean(state.connected && state.ready && !state.opening && state.chatId)
}

/** Appends the optimistic "New session" divider stamped with the live time so it matches web immediately. */
export function optimisticNewSession(chat: ChatView, now = Date.now()): ChatView {
  const next = withNewSession(chat)
  const last = next.items[next.items.length - 1]
  if (last?.kind === 'session' && last.at === undefined) {
    return { ...next, items: [...next.items.slice(0, -1), { ...last, at: now }] }
  }
  return next
}

/** Applies a `chat.new` snapshot and ensures the active empty new session always carries its "New session" divider. */
export function confirmNewSessionSnapshot(snapshot: ChatSnapshot, previous: ChatView, startedAt: number): ChatView {
  const view = chatFromSnapshot(snapshot, previous)
  const last = view.items[view.items.length - 1]
  if (last?.kind === 'session' || view.items.length > 0) return view
  return {
    ...view,
    items: [{ kind: 'session', id: `session:${snapshot.chatId}`, at: startedAt, text: 'New session' }]
  }
}

/** Slot transition when starting a new session: stamps divider, marks opening, and pins scroll to latest. */
export function slotWithNewSessionStart(cur: ChatSlot, now: number): ChatSlot {
  return { ...cur, view: optimisticNewSession(cur.view, now), ready: false, scrollOffset: 0, scrollAnchor: null, scrollToLatestSeq: cur.scrollToLatestSeq + 1 }
}

/** Slot transition when `chat.open` or `chat.new` resolves. */
export function slotWithOpenedSnapshot(cur: ChatSlot, snapshot: ChatSnapshot, startNew: boolean, startedAt: number): ChatSlot {
  return {
    ...cur,
    view: startNew ? confirmNewSessionSnapshot(snapshot, cur.view, startedAt) : chatFromSnapshot(snapshot, cur.view),
    ready: true,
    error: '',
    ...(startNew ? { scrollOffset: 0, scrollAnchor: null, scrollToLatestSeq: cur.scrollToLatestSeq + 1 } : {})
  }
}
