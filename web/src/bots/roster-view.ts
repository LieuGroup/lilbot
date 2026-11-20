/** How this browser shows the roster: open or collapsed to the rail, which closed groups the
 *  user opened, and the search box. Collapse and open groups are remembered per browser. */
import { useSyncExternalStore } from 'react'
import { create } from 'zustand'

export type ClosedGroup = 'unassigned' | 'hidden'

const COLLAPSED_KEY = 'lilbot.roster-collapsed'
const groupKey = (group: ClosedGroup) => `lilbot.roster-open.${group}`

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered in a private window; it stays as chosen until reload.
  }
}

interface RosterView {
  collapsed: boolean
  /** The search box's text, or null while it is closed. */
  query: string | null
  open: Record<ClosedGroup, boolean>
}

export const useRosterView = create<RosterView>(() => ({
  collapsed: stored(COLLAPSED_KEY) === 'collapsed',
  query: null,
  open: { unassigned: stored(groupKey('unassigned')) === 'open', hidden: stored(groupKey('hidden')) === 'open' }
}))

/** Collapse to the rail, or open the roster again (with the search box ready when `query` is ''). */
export function setCollapsed(collapsed: boolean, query: string | null = null) {
  remember(COLLAPSED_KEY, collapsed ? 'collapsed' : 'open')
  useRosterView.setState({ collapsed, query })
}

export const setQuery = (query: string | null) => useRosterView.setState({ query })

export function setGroupOpen(group: ClosedGroup, open: boolean) {
  remember(groupKey(group), open ? 'open' : 'closed')
  useRosterView.setState(state => ({ open: { ...state.open, [group]: open } }))
}

const wide = typeof window === 'undefined' ? null : window.matchMedia('(min-width: 768px)')
const subscribe = (onChange: () => void) => {
  wide?.addEventListener('change', onChange)
  return () => wide?.removeEventListener('change', onChange)
}

/** The rail shows only on a wide screen: on a phone the roster is already a full screen. */
export function useRailShown(): boolean {
  const isWide = useSyncExternalStore(subscribe, () => wide?.matches ?? false)
  return useRosterView(state => state.collapsed) && isWide
}

/** The rail's code, fetched at once when this browser starts collapsed. */
export const loadRail = () => import('./roster-rail')
if (useRosterView.getState().collapsed && wide?.matches) void loadRail()
