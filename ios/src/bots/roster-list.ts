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
 *  Hides the Search icon whenever the search bar is already visible (pull-down or screen reader). */
export function rosterHeaderActionsVisibility(input: {
  hasHeader: boolean
  splitMode: boolean
  searchVisible: boolean
}): { showSearch: boolean; showNewBot: boolean } {
  if (!input.hasHeader) return { showSearch: false, showNewBot: false }
  return { showSearch: !input.searchVisible, showNewBot: input.splitMode }
}

/** Pull-down distance past the resting top inset for pull-to-search.
 *  Returns 0 unless the user is actively dragging so iOS `contentInsetAdjustmentBehavior="automatic"`
 *  insets (such as iPad's top tab bar) never open Search on initial layout. */
export function rosterPullDownDistance(input: { contentOffsetY: number; contentInsetTop?: number; userDragging: boolean }): number {
  if (!input.userDragging) return 0
  return Math.max(0, -(input.contentOffsetY + (input.contentInsetTop ?? 0)))
}
