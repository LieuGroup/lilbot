/** Per-bot `localStorage` persistence for the tasks dock (collapsed state and dismissed rows, synced across tabs) plus
 *  selection of the best `needs_oscar` work item per exchange. */
import type { WorkSummary } from '../../../shared/work-schema'

export const COLLAPSED_PREFIX = 'lilbot.dock-collapsed.'
export const DISMISSED_PREFIX = 'lilbot.dock-dismissed.'
const MAX_DISMISSED_PER_BOT = 200
const EMPTY: Record<string, number> = {}
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

function parseDismissed(raw: string | null): Record<string, number> {
  if (!raw) return EMPTY
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY
    const out: Record<string, number> = {}
    for (const [id, stamp] of Object.entries(parsed)) {
      if (typeof stamp === 'number' && Number.isFinite(stamp)) out[id] = stamp
    }
    return Object.keys(out).length ? out : EMPTY
  } catch {
    return EMPTY
  }
}

/** Referentially stable read of a bot's dismissed dock items (`threadId -> end timestamp`). */
export function readDismissed(botId: string): Record<string, number> {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(`${DISMISSED_PREFIX}${botId}`)
  } catch {
    return EMPTY
  }
  const hit = dismissedCache.get(botId)
  if (hit && hit.raw === raw) return hit.map
  const map = parseDismissed(raw)
  dismissedCache.set(botId, { raw, map })
  return map
}

/** Caps stored dismissals to the newest entries per bot so `localStorage` stays bounded. */
export function pruneDismissed(map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map)
  if (entries.length <= MAX_DISMISSED_PER_BOT) return map
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return Object.fromEntries(entries.slice(0, MAX_DISMISSED_PER_BOT))
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

const isOscarCheck = (item: WorkSummary) => item.check?.by.kind === 'oscar' && item.check.state === 'checking'
const waitingRank = (item: WorkSummary) => (item.id === item.origin.id ? 2 : 0) + (isOscarCheck(item) ? 0 : 1)

/** Picks the best `needs_oscar` work item per exchange: the exchange's own item first, then an answerable question over a check. */
export function selectWaitingWork(items: WorkSummary[]): Record<string, WorkSummary> {
  const out: Record<string, WorkSummary> = {}
  for (const item of items) {
    if (item.origin.kind !== 'exchange') continue
    const current = out[item.origin.id]
    if (!current || waitingRank(item) > waitingRank(current) || (waitingRank(item) === waitingRank(current) && item.updatedAt > current.updatedAt)) {
      out[item.origin.id] = item
    }
  }
  return out
}
