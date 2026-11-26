/** Pure collapsed Tasks pill presentation rules and Duo-safe sheet padding.
 *  Zero React Native runtime imports so unit tests verify 1-tap Answer and Dynamic Type wrapping on Linux. */
import { type DockItem, dockCollapsedSummary, dockRowTitle } from '../../../shared/client/threads/dock-items'
import { type LineState, taskTitle } from '../../../shared/client/threads/thread-lines'
import type { WorkSummary } from '../../../shared/work-schema'

export interface DockPillModel {
  icon: LineState['icon']
  /** Compact bold lead text shown inside the 32 pt pill (e.g. `2 · Confirm region` or `2 running`). */
  lead: string
  /** Optional muted trailing detail when no answerable question dominates the pill. */
  detail: string
  /** Set when a `needs_oscar` question can be answered in 1 tap directly from the collapsed pill. */
  answerTarget: { work: WorkSummary; title: string } | null
  accessibilityLabel: string
}

/** Build note 2 on #316: the longest wording ("2 for Chief of Staff (1 waiting for you) · 1 handed out") does not fit a
 *  portrait phone, so iPhone and folded Duo in portrait take the short form; unfolded Duo and landscape keep the full one. */
export function compactDockWording(window: { width: number; height: number }): boolean {
  return window.height > window.width && window.width < 600
}

/** Builds the collapsed Tasks pill model so any waiting bot question exposes a 1-tap `Answer` action directly on the pill. */
export function buildDockPillModel(items: DockItem[], botId: string, compact = false): DockPillModel | null {
  if (items.length === 0) return null
  const answerable = items.find(item => item.kind === 'waiting_oscar' && item.canAnswer && item.waiting)
  if (answerable && answerable.waiting) {
    const question = answerable.waiting.question?.trim() || taskTitle(answerable.thread)
    const lead = items.length > 1 ? `${items.length} · ${question}` : question
    const title = dockRowTitle(answerable, botId, false)
    return {
      icon: 'waiting',
      lead,
      detail: '',
      answerTarget: { work: answerable.waiting, title },
      accessibilityLabel: `Tasks in flight, ${items.length} active, waiting for your answer: ${question}. Swipe up or tap to expand.`
    }
  }
  const summary = dockCollapsedSummary(items, botId, compact)
  return {
    icon: summary.icon,
    lead: summary.lead,
    detail: summary.detail,
    answerTarget: null,
    accessibilityLabel: `Tasks in flight, ${summary.lead}${summary.detail ? `, ${summary.detail}` : ''}. Swipe up or tap to expand.`
  }
}

/** Wraps the collapsed pill's 1-tap Answer action onto its own clean row at AX sizes or narrow widths so it never clips. */
export function shouldWrapDockPill(input: { fontScale: number; availableWidth?: number }): boolean {
  if (input.fontScale >= 1.6) return true
  if (input.availableWidth !== undefined && input.availableWidth > 0 && input.availableWidth < 280) return true
  return false
}

/** Safe-area padding for native `pageSheet` modals so Folded Duo's trailing 84 pt rail and status clock never overlap controls. */
export function duoSafeSheetPadding(insets: { left: number; right: number; bottom: number }) {
  return {
    paddingLeft: Math.max(16, insets.left + 12),
    paddingRight: Math.max(20, insets.right + 12),
    paddingBottom: Math.max(16, insets.bottom + 12)
  }
}

/** Dynamic Type caps for tasks dock and opened thread chrome so AX5 remains legible without 3-letter truncation or clipping. */
export const THREAD_TYPE_CAPS = {
  pillText: 1.75,
  actionButton: 1.5,
  rowTitle: 1.85,
  rowState: 1.7,
  headerTitle: 1.45,
  badge: 1.4
} as const
