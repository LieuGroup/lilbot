/** Search bots from a chat screen's `•••` menu (#313): once the Bots root is focused, show the roster (reopening the
 *  split sidebar if it was hidden) and then open its search. */
import { useEffect } from 'react'
import { useBotMenuStore } from '../bots/menu-store'

export function useRosterSearchRequest(input: { focused: boolean; rosterShown: boolean; showRoster: () => void; openSearch: () => void }) {
  const requested = useBotMenuStore(state => state.rosterSearchRequested)
  const clearRequest = useBotMenuStore(state => state.clearRosterSearchRequest)
  const { focused, rosterShown, showRoster, openSearch } = input

  useEffect(() => {
    if (!requested || !focused) return
    if (!rosterShown) {
      showRoster()
      return
    }
    clearRequest()
    openSearch()
  }, [clearRequest, focused, openSearch, requested, rosterShown, showRoster])
}
