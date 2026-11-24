/** Virtualized Round 4 Roster item flattening, section collapse rules, and status notices
 *  (1:1 with web/src/bots/bot-sidebar.tsx). Zero React Native imports so unit tests run on Linux. */
import type { Bot, Section } from '../../../shared/bot-schema'
import { rosterGroups, searchBots } from '../../../shared/client/bots/roster-groups'
import { type RunningGroup, runningGroups } from '../../../shared/client/bots/running-groups'

export type RosterListItem =
  | { kind: 'tiles'; key: string; bots: Bot[] }
  | { kind: 'groups'; key: string; groups: RunningGroup[] }
  | { kind: 'section-header'; key: string; sectionId: string; name: string; open: boolean }
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

/** Flattens visible roster sections into virtualizable FlatList items. */
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
  collapsedSections?: Readonly<Record<string, boolean>>
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

  const collapsed = input.collapsedSections ?? {}
  for (const { section, bots } of groups.sections) {
    const open = !collapsed[section.id] || bots.some(bot => bot.id === input.selectedId)
    out.push({ kind: 'section-header', key: `sec:${section.id}`, sectionId: section.id, name: section.name, open })
    if (open) pushBots(out, bots, `sec:${section.id}`)
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

/** First existing header item key that hosts inline header actions (Search on phone/iPad, plus New bot on split) at zero extra row height. */
export function firstRosterHeaderKey(items: readonly RosterListItem[]): string | null {
  const first = items.find(item => item.kind === 'section-header' || item.kind === 'group-toggle')
  return first ? first.key : null
}

/** Which inline actions to show at the right end of the first roster header line.
 *  Hides the Search icon whenever the search bar is already open,
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

/** Fallback top-right Search (+ New bot on non-Duo split) when no section/group header exists
 *  on ordinary iPhone/iPad, so removing pull-to-search never strands a flat or 1-bot list without Search. */
export function standaloneRosterHeaderActions(input: {
  hasHeader: boolean
  hasBots: boolean
  splitMode: boolean
  searchVisible: boolean
  hideInlineSearch?: boolean
  hideInlineNewBot?: boolean
}): { showSearch: boolean; showNewBot: boolean } {
  if (input.hasHeader || !input.hasBots || input.searchVisible) return { showSearch: false, showNewBot: false }
  const showSearch = !input.hideInlineSearch
  const showNewBot = showSearch && input.splitMode && !input.hideInlineNewBot
  return { showSearch, showNewBot }
}

/** Pure search state transitions wired directly into DuoShell and Roster:
 *  - open opens with a clean query;
 *  - strip toggle opens when closed, closes and clears query when open;
 *  - close button (`X`) and leaving the list always close and clear query. */
export interface RosterSearchState {
  open: boolean
  query: string
}

export const INITIAL_ROSTER_SEARCH_STATE: RosterSearchState = { open: false, query: '' }

export function openRosterSearch(state: RosterSearchState): RosterSearchState {
  return state.open ? state : { open: true, query: '' }
}

export function toggleRosterSearch(state: RosterSearchState): RosterSearchState {
  return state.open ? { open: false, query: '' } : { open: true, query: '' }
}

export function closeRosterSearch(): RosterSearchState {
  return { open: false, query: '' }
}

export function setRosterSearchQuery(state: RosterSearchState, query: string): RosterSearchState {
  return state.open ? { open: true, query } : state
}
