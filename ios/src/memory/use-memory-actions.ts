/** The Memory page's writes (Pause or Resume, Forget, Restore, Connect, Add a fact), one at a time, plus the facts
 *  every list has shown so a pushed fact page can draw the fact it was opened from. The calls match the web's page. */
import { useCallback, useRef, useState } from 'react'
import { create } from 'zustand'
import { messageOf } from '../../../shared/client/socket'
import type { MemoryBrowsePage, MemoryFact } from '../../../shared/memory-schema'
import { ensureSocket } from '../connection/lilbot'

/** Facts and bot names from the lists on screen; each list reloads on `memory.changed`, so this stays current. */
export const useMemorySeen = create<{ facts: Record<string, MemoryFact>; names: Record<string, string> }>(() => ({ facts: {}, names: {} }))

export function rememberPage(page: MemoryBrowsePage, facts: MemoryFact[]) {
  useMemorySeen.setState(state => ({
    facts: { ...state.facts, ...Object.fromEntries(facts.map(fact => [fact.id, fact])) },
    names: { ...state.names, ...Object.fromEntries(page.bots.map(bot => [bot.botId, bot.name])) }
  }))
}

const patchFact = (fact: MemoryFact) => useMemorySeen.setState(state => ({ facts: { ...state.facts, [fact.id]: fact } }))

export interface NewFact {
  botId: string
  shared: boolean
  text: string
}

export function useMemoryActions() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const busyRef = useRef(false)

  const run = useCallback(async (action: () => Promise<unknown>): Promise<boolean> => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setError('')
    try {
      await action()
      return true
    } catch (failure) {
      setError(messageOf(failure))
      return false
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [])

  const socket = () => {
    const live = ensureSocket()
    if (!live) throw new Error('Not connected')
    return live
  }

  const pause = useCallback(
    (fact: MemoryFact) =>
      run(async () => {
        await socket().call('memory.pause', { factId: fact.id, paused: !fact.paused })
        patchFact({ ...fact, paused: !fact.paused })
      }),
    [run]
  )
  const forget = useCallback((fact: MemoryFact) => run(() => socket().call('memory.forget', { factId: fact.id })), [run])
  const restore = useCallback((fact: MemoryFact) => run(() => socket().call('memory.restore', { factId: fact.id })), [run])
  const connect = useCallback((page: MemoryBrowsePage) => run(() => Promise.all(page.notConnected.map(bot => socket().call('memory.connect', { botId: bot.botId })))), [run])
  const add = useCallback(
    (fact: NewFact) => run(() => socket().call('memory.write', { botId: fact.botId, kind: 'profile', scope: fact.shared ? 'shared' : 'bot', text: fact.text })),
    [run]
  )

  return { busy, error, pause, forget, restore, connect, add }
}

