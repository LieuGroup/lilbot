/** Which exchange is open in a bot's conversation column: the `thread` search parameter of `/bots/$botId`, so a reload, a
 *  link and the phone's back gesture keep it, and the details tab beside it can change without closing it." */
import { useNavigate, useRouterState } from '@tanstack/react-router'

export const threadSearch = (search: Record<string, unknown>): { thread?: string } => (typeof search.thread === 'string' && search.thread ? { thread: search.thread } : {})

export function useOpenThreadId(): string | undefined {
  return useRouterState({ select: state => threadSearch(state.location.search).thread })
}

/** Opens an exchange in place of the conversation, or closes it ("Back to chat"). On a phone the details panel covers the
 *  column, so opening from it goes back to the conversation. */
export function useThreadNavigation(botId: string) {
  const navigate = useNavigate()
  const wide = () => window.matchMedia('(min-width: 768px)').matches
  return {
    open: (threadId: string) =>
      wide() ? navigate({ to: '.', search: previous => ({ ...previous, thread: threadId }) }) : navigate({ to: '/bots/$botId', params: { botId }, search: { thread: threadId } }),
    close: () => navigate({ to: '.', search: ({ thread: _closed, ...rest }) => rest })
  }
}
