/** The bot's Library for one filter (`library.list`), read again when the bot gives a file (`library.changed`) and on
 *  reconnect. "Show more" reads the next page; a fresh read keeps as many items as were shown. A reply for an earlier
 *  bot or filter is dropped. */
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
  const latest = useRef(0)
  const kinds = FILTERS.find(item => item.id === filter)?.kinds

  const read = useCallback(async () => {
    const request = ++latest.current
    try {
      const next = await lilbot.call('library.list', { botId, kinds: kinds && [...kinds], offset: 0, limit: Math.min(MAX_PAGE, Math.max(PAGE, shown.current)) })
      if (request !== latest.current) return
      setPage(next)
      setError('')
    } catch (failure) {
      if (request === latest.current) setError(messageOf(failure))
    }
  }, [botId, kinds])

  // Another bot or filter starts again from the first page.
  useEffect(() => {
    shown.current = PAGE
    setPage(undefined)
    setError('')
  }, [read])

  useEffect(() => {
    if (connected) void read()
    return lilbot.onLibraryChanged(changed => {
      if (changed === botId) void read()
    })
  }, [botId, connected, read])

  const more = async () => {
    if (page?.nextOffset == null) return
    const request = latest.current
    setLoadingMore(true)
    try {
      const next = await lilbot.call('library.list', { botId, kinds: kinds && [...kinds], offset: page.nextOffset, limit: PAGE })
      if (request !== latest.current) return
      setPage(current => current && { ...next, items: [...current.items, ...next.items.filter(item => !current.items.some(seen => seen.id === item.id))] })
      shown.current = page.items.length + next.items.length
    } catch (failure) {
      if (request === latest.current) setError(messageOf(failure))
    } finally {
      setLoadingMore(false)
    }
  }
  return { page, error, more, loadingMore }
}
