/** What is open over a bot's conversation and in its panel: the search parameters of `/bots/$botId`, so a reload, a link
 *  and the phone's back gesture keep them, and the details tab beside them can change without closing them. `thread` is an
 *  exchange and `run` a routine run, each drawn in the conversation column (one at a time); `routine` is one routine in
 *  the details panel and `skill` one skill in its Setup tab. */
import { useNavigate, useRouterState } from '@tanstack/react-router'

export interface BotSearch {
  thread?: string
  run?: string
  routine?: string
  skill?: string
}

const KEYS = ['thread', 'run', 'routine', 'skill'] as const

export function botSearch(search: Record<string, unknown>): BotSearch {
  const kept: BotSearch = {}
  for (const key of KEYS) {
    const value = search[key]
    if (typeof value === 'string' && value) kept[key] = value
  }
  return kept
}

export function useBotSearch(key: keyof BotSearch): string | undefined {
  return useRouterState({ select: state => botSearch(state.location.search)[key] })
}

export const useOpenThreadId = () => useBotSearch('thread')

/** Opens an exchange or a run in place of the conversation (one at a time), or closes it ("Back to chat"). On a phone the
 *  details panel covers the column, so opening from it goes back to the conversation. */
export function useColumnNavigation(botId: string, key: 'thread' | 'run') {
  const navigate = useNavigate()
  const wide = () => window.matchMedia('(min-width: 768px)').matches
  return {
    open: (id: string) =>
      wide()
        ? navigate({ to: '.', search: ({ thread: _thread, run: _run, ...rest }: BotSearch) => ({ ...rest, [key]: id }) })
        : navigate({ to: '/bots/$botId', params: { botId }, search: { [key]: id } }),
    close: () => navigate({ to: '.', search: ({ [key]: _closed, ...rest }: BotSearch) => rest })
  }
}

export const useThreadNavigation = (botId: string) => useColumnNavigation(botId, 'thread')
