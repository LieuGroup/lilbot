/** The details panel's tabs, which one is open, and whether a wide screen opens it by itself. */
import { useRouterState } from '@tanstack/react-router'

export const DETAILS_TABS = [
  { id: 'activity', label: 'Activity' },
  { id: 'library', label: 'Library' },
  { id: 'memory', label: 'Memory' },
  { id: 'setup', label: 'Setup' }
] as const
export type DetailsTab = (typeof DETAILS_TABS)[number]['id']

export const isDetailsTab = (value: string | undefined): value is DetailsTab => DETAILS_TABS.some(tab => tab.id === value)

/** The open tab, or undefined when the panel is closed. */
export function useDetailsTab(): DetailsTab | undefined {
  return useRouterState({
    select: state => {
      const tab = (state.matches.find(match => match.routeId === '/bots/$botId/$tab')?.params as { tab?: string } | undefined)?.tab
      return isDetailsTab(tab) ? tab : undefined
    }
  })
}

/** The bot whose screen is open, if any. */
export function useOpenBotId(): string | undefined {
  return useRouterState({ select: state => (state.matches.find(match => match.routeId === '/bots/$botId')?.params as { botId?: string } | undefined)?.botId })
}

const KEY = 'lilbot.details-open'

/** On a wide screen the panel opens beside the chat unless the user closed it. Phones open it
 *  only when asked, because it covers the chat there. Storage can be unavailable (private
 *  windows); the panel then simply opens by default. */
export function detailsOpenByDefault(): boolean {
  if (!window.matchMedia('(min-width: 1280px)').matches) return false
  try {
    return localStorage.getItem(KEY) !== 'closed'
  } catch {
    return true
  }
}

export function rememberDetailsOpen(open: boolean) {
  try {
    localStorage.setItem(KEY, open ? 'open' : 'closed')
  } catch {
    // Not remembered in a private window: the default applies next time.
  }
}
