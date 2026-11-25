/** Live Library list hook (`library.list` + `library.changed`) with filter and pagination. */
import { useCallback, useEffect, useState } from 'react'
import type { LibraryPage } from '../../../shared/library-schema'
import { messageOf } from '../../../shared/client/socket'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { LIBRARY_FILTERS, type LibraryFilter } from './library-lines'

export function useLibrary(botId: string, filter: LibraryFilter) {
  const connected = useConnectionStore(state => state.connected)
  const [page, setPage] = useState<LibraryPage | null>(null)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)

  const kinds = LIBRARY_FILTERS.find(f => f.id === filter)?.kinds

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !connected) return
    try {
      const next = await socket.call('library.list', { botId, ...(kinds ? { kinds: [...kinds] } : {}), offset: 0, limit: 50 })
      setPage(next)
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    }
  }, [botId, connected, kinds])

  useEffect(() => {
    setPage(null)
    void load()
    const socket = ensureSocket()
    if (!socket) return
    return socket.onLibraryChanged(changedBotId => {
      if (changedBotId === botId) void load()
    })
  }, [botId, load])

  const more = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !page || page.nextOffset === null || loadingMore) return
    setLoadingMore(true)
    try {
      const next = await socket.call('library.list', { botId, ...(kinds ? { kinds: [...kinds] } : {}), offset: page.nextOffset, limit: 50 })
      setPage(prev => (prev ? { items: [...prev.items, ...next.items], total: next.total, nextOffset: next.nextOffset } : next))
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      setLoadingMore(false)
    }
  }, [botId, kinds, loadingMore, page])

  return { page, error, more, loadingMore }
}
