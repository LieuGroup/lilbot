/** Live Library list hook (`library.list` + `library.changed`) with filter, monotonic sequence guard,
 *  and pagination preservation on background updates. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { LibraryPage } from '../../../shared/library-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { LIBRARY_FILTERS, type LibraryFilter } from './library-lines'

const PAGE_SIZE = 50
const MAX_REFRESH_LIMIT = 200

export function useLibrary(botId: string, filter: LibraryFilter) {
  const connected = useConnectionStore(state => state.connected)
  const [page, setPage] = useState<LibraryPage | null>(null)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const loadSeqRef = useRef(0)
  const loadedCountRef = useRef(PAGE_SIZE)

  const kinds = LIBRARY_FILTERS.find(f => f.id === filter)?.kinds

  const load = useCallback(
    async (preserveLoaded = false) => {
      const socket = ensureSocket()
      if (!socket || !connected) return
      const seq = ++loadSeqRef.current
      const limit = preserveLoaded ? Math.min(MAX_REFRESH_LIMIT, Math.max(PAGE_SIZE, loadedCountRef.current)) : PAGE_SIZE
      try {
        const next = await socket.call('library.list', { botId, ...(kinds ? { kinds: [...kinds] } : {}), offset: 0, limit })
        if (seq !== loadSeqRef.current) return
        loadedCountRef.current = Math.max(PAGE_SIZE, next.items.length)
        setPage(next)
        setError('')
      } catch (failure) {
        if (seq !== loadSeqRef.current) return
        setError(messageOf(failure))
      }
    },
    [botId, connected, kinds]
  )

  useEffect(() => {
    loadSeqRef.current += 1
    loadedCountRef.current = PAGE_SIZE
    setPage(null)
    void load(false)
    const socket = ensureSocket()
    if (!socket) return
    return socket.onLibraryChanged(changedBotId => {
      if (changedBotId === botId) void load(true)
    })
  }, [botId, load])

  const more = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !page || page.nextOffset === null || loadingMore) return
    const seq = loadSeqRef.current
    setLoadingMore(true)
    try {
      const next = await socket.call('library.list', { botId, ...(kinds ? { kinds: [...kinds] } : {}), offset: page.nextOffset, limit: PAGE_SIZE })
      if (seq !== loadSeqRef.current) return
      setPage(prev => {
        if (!prev) return next
        const items = [...prev.items, ...next.items]
        loadedCountRef.current = Math.max(PAGE_SIZE, items.length)
        return { items, total: next.total, nextOffset: next.nextOffset }
      })
      setError('')
    } catch (failure) {
      if (seq === loadSeqRef.current) setError(messageOf(failure))
    } finally {
      setLoadingMore(false)
    }
  }, [botId, kinds, loadingMore, page])

  return { page, error, more, loadingMore }
}
