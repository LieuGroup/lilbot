/** The bot's Library for one filter (`library.list`), read again when the bot gives a file (`library.changed`) and on
 *  reconnect. "Show more" reads the next page; a fresh read keeps as many items as were shown. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryPage } from '../../../shared/library-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'
import { FILTERS, type LibraryFilter } from './library-lines'

const PAGE = 30
const MAX_PAGE = 100

export function useLibrary(botId: string, filter: LibraryFilter) {
  const connected = useBotStore(state => state.connected)
  const [page, setPage] = useState<LibraryPage>()
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const shown = useRef(PAGE)
  const kinds = FILTERS.find(item => item.id === filter)?.kinds

  const read = useCallback(async () => {
    try {
      const next = await lilbot.call('library.list', { botId, kinds: kinds && [...kinds], offset: 0, limit: Math.min(MAX_PAGE, Math.max(PAGE, shown.current)) })
      setPage(next)
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [botId, kinds])

  useEffect(() => {
    shown.current = PAGE
    setPage(undefined)
    if (connected) void read()
    return lilbot.onLibraryChanged(changed => {
      if (changed === botId) void read()
    })
  }, [botId, connected, read])

  const more = async () => {
    if (page?.nextOffset == null) return
    setLoadingMore(true)
    try {
      const next = await lilbot.call('library.list', { botId, kinds: kinds && [...kinds], offset: page.nextOffset, limit: PAGE })
      setPage(current => current && { ...next, items: [...current.items, ...next.items.filter(item => !current.items.some(seen => seen.id === item.id))] })
      shown.current = page.items.length + next.items.length
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setLoadingMore(false)
    }
  }
  return { page, error, more, loadingMore }
}
