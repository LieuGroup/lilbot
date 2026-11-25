import { useCallback, useEffect, useRef, useState } from 'react'
import type { MemoryBrowsePage, MemoryFact } from '../../../shared/memory-schema'
import type { Params } from '../../../shared/protocol'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { useBotStore } from '../bots/bot-store'

type Request = Omit<Params<'memory.listAll'>, 'cursor'>

/** One list of the Memory page, read again whenever memory changes (a bot saved a fact, or another device
 *  paused one). `more` adds the next page; a reload keeps as many facts as were already shown. */
export function useMemoryList(request: Request) {
  const connected = useBotStore(state => state.connected)
  const [page, setPage] = useState<MemoryBrowsePage | null>(null)
  const [facts, setFacts] = useState<MemoryFact[]>([])
  const [error, setError] = useState('')
  const shown = useRef(0)
  const loadingMore = useRef(false)
  const key = JSON.stringify(request)

  const load = useCallback(async () => {
    const params: Request = JSON.parse(key)
    try {
      const next = await lilbot.call('memory.listAll', { ...params, limit: Math.min(Math.max(shown.current, params.limit ?? 50), 200) })
      shown.current = next.facts.length
      setPage(next)
      setFacts(next.facts)
      setError('')
    } catch (failure) {
      setError(messageOf(failure))
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
    return lilbot.onMemoryChanged(() => void load())
  }, [connected, load])

  const more = async () => {
    if (!page?.nextCursor || loadingMore.current) return
    loadingMore.current = true
    try {
      const next = await lilbot.call('memory.listAll', { ...(JSON.parse(key) as Request), cursor: page.nextCursor, limit: 50 })
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
  }

  return { page, facts, error, more }
}
