/** Live iOS Work store and badge hooks bound to the shared LilBot socket.
 *  Re-syncs on server/token change without double-loading on reconnect (`connected` is intentionally omitted from hook deps). */
import { useEffect } from 'react'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { createWorkStore, type WorkSocket } from './store-core'

const manager = createWorkStore(() => ensureSocket() as WorkSocket | null)

useConnectionStore.subscribe((state, prev) => {
  if (state.settings !== prev.settings) manager.syncSocket()
})

export const useWorkStore = manager.useStore
export const answerWorkItem = manager.answerWorkItem
export const passWorkItem = manager.passWorkItem
export const sendBackWorkItem = manager.sendBackWorkItem
export const dropWorkItem = manager.dropWorkItem
export const setWorkLevel = manager.setWorkLevel

export function useWorkBrief() {
  const settings = useConnectionStore(state => state.settings)
  useEffect(() => {
    void settings
    return manager.watchBrief()
  }, [settings])
  const brief = useWorkStore(s => s.brief)
  const active = useWorkStore(s => s.active)
  const error = useWorkStore(s => s.briefError)
  return { brief, active, error }
}

export function useWorkList(botId: string | undefined, from: number | undefined) {
  const settings = useConnectionStore(state => state.settings)
  useEffect(() => {
    void settings
    return manager.watchList(botId, from)
  }, [botId, from, settings])
  const list = useWorkStore(s => s.list)
  const loaded = useWorkStore(s => s.listLoaded)
  const error = useWorkStore(s => s.listError)
  return { list, loaded, error }
}

export function useWorkItem(itemId: string) {
  const settings = useConnectionStore(state => state.settings)
  useEffect(() => {
    void settings
    if (!itemId) return
    return manager.watchItem(itemId)
  }, [itemId, settings])
  const item = useWorkStore(s => s.items[itemId])
  const error = useWorkStore(s => s.itemErrors[itemId] ?? '')
  return { item, error }
}

export function useWorkLevels() {
  const settings = useConnectionStore(state => state.settings)
  useEffect(() => {
    void settings
    return manager.watchLevels()
  }, [settings])
  const levels = useWorkStore(s => s.levels)
  const error = useWorkStore(s => s.levelsError)
  return { levels, error }
}

/** Count of `needs_oscar` work items for the Work tab's native badge (excludes waiting goals until Goals ships). */
export function useNeedsYouCount(): number {
  const settings = useConnectionStore(state => state.settings)
  useEffect(() => {
    void settings
    return manager.watchBadge()
  }, [settings])
  return useWorkStore(s => s.badgeCount)
}
