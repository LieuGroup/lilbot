/** One list of the Memory page (`memory.listAll`), read again whenever memory changes (a bot saved a fact, or another
 *  device paused one). `more` adds the next page and ignores a second tap while one loads; a reload keeps as many facts
 *  as were already shown. The same rules as the web's `use-memory-list.ts`. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { messageOf } from '../../../shared/client/socket'
import type { MemoryBrowsePage, MemoryFact } from '../../../shared/memory-schema'
import type { Params } from '../../../shared/protocol'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'

type Request = Omit<Params<'memory.listAll'>, 'cursor'>

export function useMemoryList(request: Request) {
  const connected = useConnectionStore(state => state.connected)
  const [page, setPage] = useState<MemoryBrowsePage | null>(null)
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [error, setError] = useState('')
  const shown = useRef(0)
  const loadingMore = useRef(false)
  const loadSeq = useRef(0)
  const key = JSON.stringify(request)

  const load = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket) return
    const params: Request = JSON.parse(key)
    const seq = ++loadSeq.current
    try {
      const next = await socket.call('memory.listAll', { ...params, limit: Math.min(Math.max(shown.current, params.limit ?? 50), 200) })
      if (seq !== loadSeq.current) return
      shown.current = next.facts.length
      setPage(next)
      setFacts(next.facts)
      setError('')
    } catch (failure) {
      if (seq === loadSeq.current) setError(messageOf(failure))
    }
  }, [key])

  useEffect(() => {
    shown.current = 0
    setPage(null)
    setFacts([])
  }, [key])

  useEffect(() => {
    if (!connected) return
    void load()
    const socket = ensureSocket()
    if (!socket) return
    return socket.onMemoryChanged(() => void load())
  }, [connected, load])

  const more = useCallback(async () => {
    const socket = ensureSocket()
    if (!socket || !page?.nextCursor || loadingMore.current) return
    loadingMore.current = true
    try {
      const next = await socket.call('memory.listAll', { ...(JSON.parse(key) as Request), cursor: page.nextCursor, limit: 50 })
      setFacts(previous => {
        shown.current = previous.length + next.facts.length
        return [...previous, ...next.facts]
      })
      setPage(next)
    } catch (failure) {
      setError(messageOf(failure))
    } finally {
      loadingMore.current = false
    }
  }, [key, page?.nextCursor])

  return { page, facts, error, more }
}
