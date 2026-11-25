/** Live iOS Work store and badge hooks bound to the shared LilBot socket. */
import { type DependencyList, useEffect } from 'react'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { createWorkStore, type WorkSocket } from './store-core'

const manager = createWorkStore(() => ensureSocket() as WorkSocket | null)

export const useWorkStore = manager.useStore
export const answerWorkItem = manager.answerWorkItem
export const passWorkItem = manager.passWorkItem
export const sendBackWorkItem = manager.sendBackWorkItem
export const dropWorkItem = manager.dropWorkItem
export const setWorkLevel = manager.setWorkLevel
export const watchWorkBadge = manager.watchBadge

function useWorkSubscription(run: () => Promise<void>, deps: DependencyList) {
  const connected = useConnectionStore(state => state.connected)
  const settings = useConnectionStore(state => state.settings)
  useEffect(() => {
    const socket = ensureSocket()
    if (!socket) return
    if (socket.connected) void run()
    const offWork = socket.onWorkChanged(() => socket.connected && void run())
    const offConn = socket.onConnection(ok => ok && void run())
    return () => {
      offWork()
      offConn()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, settings, ...deps])
}

export function useWorkBrief() {
  useWorkSubscription(() => manager.loadBrief(), [])
  const brief = useWorkStore(s => s.brief)
  const active = useWorkStore(s => s.active)
  const error = useWorkStore(s => s.briefError)
  return { brief, active, error }
}

export function useWorkList(botId: string | undefined, from: number | undefined) {
  useWorkSubscription(() => manager.loadList(botId, from), [botId, from])
  const list = useWorkStore(s => s.list)
  const loaded = useWorkStore(s => s.listLoaded)
  const error = useWorkStore(s => s.listError)
  return { list, loaded, error }
}

export function useWorkItem(itemId: string) {
  useWorkSubscription(() => manager.loadItem(itemId), [itemId])
  const item = useWorkStore(s => s.items[itemId])
  const error = useWorkStore(s => s.itemErrors[itemId] ?? '')
  return { item, error }
}

export function useWorkLevels() {
  useWorkSubscription(() => manager.loadLevels(), [])
  const levels = useWorkStore(s => s.levels)
  const error = useWorkStore(s => s.levelsError)
  return { levels, error }
}

/** Count of `needs_oscar` work items for the Work tab's native badge (excludes waiting goals until Goals ships). */
export function useNeedsYouCount(): number {
  const connected = useConnectionStore(state => state.connected)
  const settings = useConnectionStore(state => state.settings)
  useEffect(() => {
    const off = manager.watchBadge()
    return () => off()
  }, [connected, settings])
  return useWorkStore(s => s.badgeCount)
}
