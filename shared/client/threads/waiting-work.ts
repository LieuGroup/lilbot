/** Pure persistence helpers and `needs_oscar` selection for the tasks dock, shared by web and iOS. */
import type { WorkSummary } from '../../work-schema'

export const COLLAPSED_PREFIX = 'lilbot.dock-collapsed.'
export const DISMISSED_PREFIX = 'lilbot.dock-dismissed.'
const MAX_DISMISSED_PER_BOT = 200
export const EMPTY_DISMISSED: Record<string, number> = {}

/** Parses a JSON-encoded `threadId -> end timestamp` dismissal map, returning a shared empty object when absent or invalid. */
export function parseDismissed(raw: string | null): Record<string, number> {
  if (!raw) return EMPTY_DISMISSED
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY_DISMISSED
    const out: Record<string, number> = {}
    for (const [id, stamp] of Object.entries(parsed)) {
      if (typeof stamp === 'number' && Number.isFinite(stamp)) out[id] = stamp
    }
    return Object.keys(out).length ? out : EMPTY_DISMISSED
  } catch {
    return EMPTY_DISMISSED
  }
}

/** Caps stored dismissals to the newest entries per bot so persisted storage stays bounded. */
export function pruneDismissed(map: Record<string, number>): Record<string, number> {
  const entries = Object.entries(map)
  if (entries.length <= MAX_DISMISSED_PER_BOT) return map
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return Object.fromEntries(entries.slice(0, MAX_DISMISSED_PER_BOT))
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
