/** Virtualized Roster item flattening and connecting/loading/error notice logic (1:1 with web/src/bots/bot-sidebar.tsx). */
import type { Bot, Section } from '../../../shared/bot-schema'
import { rosterGroups, searchBots } from '../../../shared/client/bots/roster-groups'
import { type RunningGroup, runningGroups } from '../../../shared/client/bots/running-groups'

export type RosterListItem =
  | { kind: 'tiles'; key: string; bots: Bot[] }
  | { kind: 'groups'; key: string; groups: RunningGroup[] }
  | { kind: 'section-header'; key: string; name: string }
  | { kind: 'group-toggle'; key: string; groupId: 'unassigned' | 'hidden'; name: string; count: number; open: boolean; testID: string }
  | { kind: 'bot'; key: string; bot: Bot; isFirst: boolean; isLast: boolean; spacedTop: boolean }
  | { kind: 'notice'; key: string; text: string; tone: 'muted' | 'destructive' }

/** Empty/connecting/loading/error copy matching web/src/bots/bot-sidebar.tsx; never shows "No bots yet." while loading or failed. */
export function rosterStatusNotice(state: {
  loaded: boolean
  connected: boolean
  error: string
  count: number
}): { text: string; tone: 'muted' | 'destructive' } | null {
  if (!state.loaded) {
    return state.error ? { text: state.error, tone: 'destructive' } : { text: state.connected ? 'Loading bots...' : 'Connecting...', tone: 'muted' }
  }
  if (state.count === 0) {
    return state.error ? { text: state.error, tone: 'destructive' } : { text: 'No bots yet.', tone: 'muted' }
  }
  return null
}

const pushBots = (out: RosterListItem[], list: Bot[], prefix: string, spacedTop = false) => {
  for (let i = 0; i < list.length; i++) {
    out.push({ kind: 'bot', key: `${prefix}:${list[i].id}`, bot: list[i], isFirst: i === 0, isLast: i === list.length - 1, spacedTop: spacedTop && i === 0 })
  }
}

/** Flattens visible roster sections into virtualizable FlatList items with card-group start/end flags. */
export function buildRosterListItems(input: {
  bots: Bot[]
  sections: Section[]
  loaded: boolean
  connected: boolean
  error: string
  query: string
  selectedId: string | null
  unassignedOpen: boolean
  hiddenOpen: boolean
}): RosterListItem[] {
  const out: RosterListItem[] = []
  if (input.query.trim().length > 0) {
    const matches = searchBots(input.bots, input.query)
    if (matches.length > 0) pushBots(out, matches, 'search')
    else if (input.loaded) out.push({ kind: 'notice', key: 'no-matches', text: 'No bot matches.', tone: 'muted' })
    return out
  }

  const notice = rosterStatusNotice({ loaded: input.loaded, connected: input.connected, error: input.error, count: input.bots.length })
  if (notice && input.bots.length === 0) {
    out.push({ kind: 'notice', key: 'status-notice', text: notice.text, tone: notice.tone })
    return out
  }

  const groups = rosterGroups(input.bots, input.sections)
  const activeGroups = runningGroups(input.bots)
  if (groups.tiled) out.push({ kind: 'tiles', key: 'pinned-tiles', bots: groups.top })
  else pushBots(out, groups.top, 'top')
  if (activeGroups.length > 0) out.push({ kind: 'groups', key: 'working-together', groups: activeGroups })

  for (const { section, bots } of groups.sections) {
    out.push({ kind: 'section-header', key: `sec:${section.id}`, name: section.name })
    pushBots(out, bots, `sec:${section.id}`)
  }

  const sectioned = groups.sections.length > 0
  const unassignedExpanded = input.unassignedOpen || groups.unassigned.some(bot => bot.id === input.selectedId)
  if (sectioned && groups.unassigned.length > 0) {
    out.push({
      kind: 'group-toggle',
      key: 'toggle:unassigned',
      groupId: 'unassigned',
      name: 'Unassigned',
      count: groups.unassigned.length,
      open: unassignedExpanded,
      testID: 'roster-group-unassigned'
    })
    if (unassignedExpanded) pushBots(out, groups.unassigned, 'unassigned')
  } else {
    pushBots(out, groups.unassigned, 'unassigned', groups.top.length > 0)
  }

  if (groups.hidden.length > 0) {
    const hiddenExpanded = input.hiddenOpen || groups.hidden.some(bot => bot.id === input.selectedId)
    out.push({
      kind: 'group-toggle',
      key: 'toggle:hidden',
      groupId: 'hidden',
      name: 'Hidden',
      count: groups.hidden.length,
      open: hiddenExpanded,
      testID: 'roster-group-hidden'
    })
    if (hiddenExpanded) pushBots(out, groups.hidden, 'hidden')
  }
  return out
}

/** First existing header item key that hosts inline header actions (Search on all layouts, plus New bot on split) at zero extra row height. */
export function firstRosterHeaderKey(items: readonly RosterListItem[]): string | null {
  const first = items.find(item => item.kind === 'section-header' || item.kind === 'group-toggle')
  return first ? first.key : null
}

/** Which inline actions to show at the right end of the first roster header line.
 *  Hides the Search icon whenever the search bar is already visible (pull-down or screen reader),
 *  and hides actions that live in iPhone Duo's native 84 pt vertical side strip. */
export function rosterHeaderActionsVisibility(input: {
  hasHeader: boolean
  splitMode: boolean
  searchVisible: boolean
  hideInlineSearch?: boolean
  hideInlineNewBot?: boolean
}): { showSearch: boolean; showNewBot: boolean } {
  if (!input.hasHeader) return { showSearch: false, showNewBot: false }
  return {
    showSearch: !input.searchVisible && !input.hideInlineSearch,
    showNewBot: input.splitMode && !input.hideInlineNewBot
  }
}

export interface PullToSearchState {
  /** Resting top contentOffset.y (e.g. -96 on iPad under the top tab capsule, 0 on iPhone). */
  restTopY: number | null
  /** contentOffset.y captured in onScrollBeginDrag while the user is actively dragging. */
  dragStartY: number | null
  /** True after the first drag since mount/layout reset so rubber-band bounce frames never overwrite restTopY. */
  hasDragged: boolean
  /** True during post-drag momentum deceleration. */
  momentumActive: boolean
}

export const INITIAL_PULL_TO_SEARCH_STATE: PullToSearchState = {
  restTopY: null,
  dragStartY: null,
  hasDragged: false,
  momentumActive: false
}

export function resetPullToSearchState(): PullToSearchState {
  return { restTopY: null, dragStartY: null, hasDragged: false, momentumActive: false }
}

/** Pull-down distance past the live resting top offset for pull-to-search.
 *  React Native Fabric sends `_scrollView.contentInset` (0 on iPad) instead of `adjustedContentInset` (96),
 *  so this learns `restTopY` from resting offsets (<= 0) and requires downward pull past BOTH `restTopY`
 *  and `dragStartY` — scrolling down from rest on iPad (-96 -> -95 -> +100) always returns 0. */
export function pullToSearchOnScroll(
  state: PullToSearchState,
  input: { contentOffsetY: number; contentInsetTop?: number }
): { state: PullToSearchState; pullDistance: number } {
  const y = input.contentOffsetY
  const insetRest = -(input.contentInsetTop ?? 0)
  if (state.dragStartY === null) {
    if (!state.hasDragged && !state.momentumActive && y <= 0) {
      const nextRest = Math.min(state.restTopY ?? insetRest, insetRest, y)
      return { state: nextRest === state.restTopY ? state : { ...state, restTopY: nextRest }, pullDistance: 0 }
    }
    return { state, pullDistance: 0 }
  }
  if (state.restTopY === null) return { state, pullDistance: 0 }
  const effectiveRest = Math.min(state.restTopY, insetRest)
  const pullDistance = Math.max(0, Math.min(effectiveRest - y, state.dragStartY - y))
  return { state, pullDistance }
}

export function pullToSearchOnDragStart(state: PullToSearchState, contentOffsetY: number): PullToSearchState {
  const restTopY = state.restTopY === null && contentOffsetY <= 0 ? contentOffsetY : state.restTopY
  return { restTopY, dragStartY: contentOffsetY, hasDragged: true, momentumActive: false }
}

export function pullToSearchOnDragEnd(state: PullToSearchState): PullToSearchState {
  return { ...state, dragStartY: null }
}

export function pullToSearchOnMomentumStart(state: PullToSearchState): PullToSearchState {
  return { ...state, dragStartY: null, momentumActive: true }
}

export function pullToSearchOnMomentumEnd(state: PullToSearchState, contentOffsetY: number): PullToSearchState {
  const restTopY =
    contentOffsetY <= 0 ? (state.restTopY === null ? contentOffsetY : Math.min(state.restTopY, contentOffsetY)) : state.restTopY
  return { restTopY, dragStartY: null, hasDragged: state.hasDragged, momentumActive: false }
}
