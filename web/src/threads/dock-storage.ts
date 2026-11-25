/** Per-bot `localStorage` persistence for the tasks dock (collapsed state and dismissed rows, synced across tabs) plus
 *  selection of the best `needs_oscar` work item per exchange. */
import { COLLAPSED_PREFIX, DISMISSED_PREFIX, EMPTY_DISMISSED, parseDismissed, pruneDismissed } from '../../../shared/client/threads/waiting-work'

export { COLLAPSED_PREFIX, DISMISSED_PREFIX, pruneDismissed, selectWaitingWork } from '../../../shared/client/threads/waiting-work'

const dismissedCache = new Map<string, { raw: string | null; map: Record<string, number> }>()

export function readCollapsed(botId: string): boolean {
  try {
    return localStorage.getItem(`${COLLAPSED_PREFIX}${botId}`) === 'collapsed'
  } catch {
    return false
  }
}

export function writeCollapsed(botId: string, collapsed: boolean) {
  try {
    localStorage.setItem(`${COLLAPSED_PREFIX}${botId}`, collapsed ? 'collapsed' : 'expanded')
  } catch {
    // Private window: kept in memory for this session.
  }
}

/** Referentially stable read of a bot's dismissed dock items (`threadId -> end timestamp`). */
export function readDismissed(botId: string): Record<string, number> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(`${DISMISSED_PREFIX}${botId}`)
  } catch {
    return EMPTY_DISMISSED
  }
  const hit = dismissedCache.get(botId)
  if (hit && hit.raw === raw) return hit.map
  const map = parseDismissed(raw)
  dismissedCache.set(botId, { raw, map })
  return map
}

export function writeDismissed(botId: string, map: Record<string, number>): Record<string, number> {
  const next = pruneDismissed(map)
  const raw = JSON.stringify(next)
  dismissedCache.set(botId, { raw, map: next })
  try {
    localStorage.setItem(`${DISMISSED_PREFIX}${botId}`, raw)
  } catch {
    // Private window: kept in memory for this session.
  }
  return next
}

/** Syncs dock collapse and dismissal changes from other tabs via the `storage` event. */
export function watchDockStorage(handlers: {
  onCollapsed: (botId: string, collapsed: boolean) => void
  onDismissed: (botId: string, map: Record<string, number>) => void
  onClear: () => void
}) {
  if (typeof window === 'undefined') return () => {}
  const onStorage = (event: StorageEvent) => {
    if (event.key === null) {
      dismissedCache.clear()
      handlers.onClear()
      return
    }
    if (event.key.startsWith(COLLAPSED_PREFIX)) {
      handlers.onCollapsed(event.key.slice(COLLAPSED_PREFIX.length), event.newValue === 'collapsed')
      return
    }
    if (event.key.startsWith(DISMISSED_PREFIX)) {
      const botId = event.key.slice(DISMISSED_PREFIX.length)
      const map = parseDismissed(event.newValue)
      dismissedCache.set(botId, { raw: event.newValue, map })
      handlers.onDismissed(botId, map)
    }
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}
