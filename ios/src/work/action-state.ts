/** Pure stale-item draft preservation, mid-send reconnect wording, and single-submit lock helpers for Work actions.
 *  Zero React Native runtime imports so every branch is unit-tested on Linux. */
import { isOscarCheck } from '../../../shared/client/work/work-lines'
import { FINAL_WORK, type WorkItem, type WorkSummary } from '../../../shared/work-schema'

export type WorkActionKind = 'question' | 'check' | 'drop'

/** Detects socket-drop errors thrown by `LilBotSocket.call()` while a mutation is in flight. */
export function isConnectionLostError(message: string): boolean {
  const lower = message.toLowerCase()
  return lower.includes('connection to lilbot was lost') || lower.includes('not connected')
}

export function isActionableQuestion(item: Pick<WorkSummary, 'status' | 'checkLevel' | 'check'> | undefined | null): boolean {
  return Boolean(item && item.status === 'needs_oscar' && !isOscarCheck(item))
}

export function isActionableOscarCheck(item: Pick<WorkSummary, 'status' | 'checkLevel' | 'check'> | undefined | null): boolean {
  return Boolean(item && item.status === 'needs_oscar' && isOscarCheck(item))
}

export function isDroppableItem(item: Pick<WorkSummary, 'status'> | undefined | null): boolean {
  return Boolean(item && !FINAL_WORK.includes(item.status))
}

/** Plain user-facing notice when an item changes underneath a typed draft or after a mid-send reconnect. */
export function staleItemNotice(
  kind: WorkActionKind,
  stillActionable: boolean,
  options: { afterReconnect?: boolean } = {}
): string | null {
  if (options.afterReconnect) {
    if (stillActionable) {
      if (kind === 'question') return 'Reconnected — your answer did not land. You can send it again.'
      if (kind === 'check') return 'Reconnected — your decision did not land. You can try again.'
      return 'Reconnected — the drop did not land. You can try again.'
    }
    if (kind === 'question') return 'Reconnected — this question is already answered.'
    if (kind === 'check') return 'Reconnected — this check already settled.'
    return 'Reconnected — this item is already finished or dropped.'
  }
  if (stillActionable) return null
  if (kind === 'question') return 'Already answered or changed on another device. Your draft is still here if you want to copy it.'
  if (kind === 'check') return 'Already checked or changed on another device. Your draft is still here if you want to copy it.'
  return 'This item already finished or was dropped elsewhere. Your draft is still here if you want to copy it.'
}

/** Synchronous single-submit lock shared across all Work forms so rapid double-taps cannot dispatch duplicate RPCs. */
export async function runSingleSubmit<T>(lockRef: { current: boolean }, task: () => Promise<T>): Promise<{ ran: boolean; value?: T }> {
  if (lockRef.current) return { ran: false }
  lockRef.current = true
  try {
    const value = await task()
    return { ran: true, value }
  } finally {
    lockRef.current = false
  }
}

export interface PreservedTodayDraft {
  item: WorkSummary
  draft: string
  lostOnDisconnect: boolean
}

/** Merges live `needsOscar` items with any preserved stale/reconnecting drafts so typing is never wiped by `work.changed`. */
export function mergeTodayNeedsItems(
  live: readonly WorkSummary[],
  preserved: Readonly<Record<string, PreservedTodayDraft>>
): Array<{ item: WorkSummary; live: boolean; lostOnDisconnect: boolean }> {
  const liveIds = new Set(live.map(item => item.id))
  const rows: Array<{ item: WorkSummary; live: boolean; lostOnDisconnect: boolean }> = live.map(item => ({
    item,
    live: true,
    lostOnDisconnect: Boolean(preserved[item.id]?.lostOnDisconnect)
  }))
  for (const [id, entry] of Object.entries(preserved)) {
    if (liveIds.has(id)) continue
    if (!entry.draft.trim() && !entry.lostOnDisconnect) continue
    rows.push({ item: entry.item, live: false, lostOnDisconnect: entry.lostOnDisconnect })
  }
  return rows
}

/** Computes whether an item page still shows a stale/reconnect banner after `item` leaves `needs_oscar`. */
export function resolveWorkItemActionState(
  item: WorkItem,
  state: { questionDraft: string; sendBackDraft: string; sendBackOpen: boolean; lostKind: 'question' | 'check' | null; reconnected: boolean }
): { showQuestion: boolean; showCheck: boolean; notice: string | null } {
  const questionLive = isActionableQuestion(item)
  const checkLive = isActionableOscarCheck(item)
  if (questionLive) {
    return {
      showQuestion: true,
      showCheck: false,
      notice: state.lostKind === 'question' && state.reconnected ? staleItemNotice('question', true, { afterReconnect: true }) : null
    }
  }
  if (checkLive) {
    return {
      showQuestion: false,
      showCheck: true,
      notice: state.lostKind === 'check' && state.reconnected ? staleItemNotice('check', true, { afterReconnect: true }) : null
    }
  }
  if (state.questionDraft.trim() || state.lostKind === 'question') {
    return {
      showQuestion: true,
      showCheck: false,
      notice: staleItemNotice('question', false, { afterReconnect: state.lostKind === 'question' && state.reconnected })
    }
  }
  if (state.sendBackDraft.trim() || state.sendBackOpen || state.lostKind === 'check') {
    return {
      showQuestion: false,
      showCheck: true,
      notice: staleItemNotice('check', false, { afterReconnect: state.lostKind === 'check' && state.reconnected })
    }
  }
  return { showQuestion: false, showCheck: false, notice: null }
}
