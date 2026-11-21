/** One routine open in the details panel (`?routine=`), and a run open in the conversation column (`?run=`). */
import { useNavigate } from '@tanstack/react-router'
import { type BotSearch, useColumnNavigation } from '../threads/open-thread'

export function useRoutineNavigation() {
  const navigate = useNavigate()
  return {
    open: (id: string) => navigate({ to: '.', search: ({ webhook: _webhook, ...previous }: BotSearch) => ({ ...previous, routine: id }) }),
    close: () => navigate({ to: '.', search: ({ routine: _closed, ...rest }: BotSearch) => rest })
  }
}

export const useRunNavigation = (botId: string) => useColumnNavigation(botId, 'run')
