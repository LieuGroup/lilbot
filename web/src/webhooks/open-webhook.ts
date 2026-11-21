/** One webhook open in the details panel (`?webhook=`), in place of an open routine. */
import { useNavigate } from '@tanstack/react-router'
import type { BotSearch } from '../threads/open-thread'

export function useWebhookNavigation() {
  const navigate = useNavigate()
  return {
    open: (id: string) => navigate({ to: '.', search: ({ routine: _routine, ...previous }: BotSearch) => ({ ...previous, webhook: id }) }),
    close: () => navigate({ to: '.', search: ({ webhook: _closed, ...rest }: BotSearch) => rest })
  }
}
