/** Live iOS threads store bound to the shared socket and AsyncStorage for per-bot dock preferences. */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { useEffect } from 'react'
import { EMPTY_DISMISSED } from '../../../shared/client/threads/waiting-work'
import { ensureSocket } from '../connection/lilbot'
import { useConnectionStore } from '../connection/store'
import { createThreadStore, type ThreadSocket } from './store-core'

const manager = createThreadStore(() => ensureSocket() as ThreadSocket | null, AsyncStorage)

useConnectionStore.subscribe((state, prev) => {
  if (state.settings !== prev.settings) manager.syncSocket()
})

export const useThreadStore = manager.useStore
export const openThreadView = manager.openView
export const closeThreadView = manager.closeView
export const setDockCollapsed = manager.setDockCollapsed
export const dismissDockItem = manager.dismissDockItem
export const stopThread = manager.stopThread
export const answerWork = manager.answerWork

/** Watches and returns a bot's exchanges, workers and groups (`undefined` until first read). Rebinds when server settings change. */
export function useThreads(botId: string) {
  const settings = useConnectionStore(state => state.settings)
  useEffect(() => manager.watchBot(botId), [botId, settings])
  return useThreadStore(state => state.byBot[botId])
}

/** Opens and watches one exchange, worker or group transcript, returning cached summary fallback while loading. */
export function useOpenedThread(botId: string, threadId: string) {
  const settings = useConnectionStore(state => state.settings)
  const threads = useThreads(botId)
  const key = manager.openKey(botId, threadId)
  useEffect(() => {
    void manager.loadOpen(botId, threadId)
  }, [botId, threadId, settings])
  const detailed = useThreadStore(state => state.opened[key])
  const error = useThreadStore(state => state.openErrors[key] ?? '')
  const fallback = threads?.find(candidate => candidate.id === threadId)
  return { thread: detailed ?? fallback, error }
}

export function useWaitingWork() {
  return useThreadStore(state => state.waitingWork)
}

export function useWorkLoaded() {
  return useThreadStore(state => state.workLoaded)
}

/** Collapsed by default on mobile (32 pt floating glass pill per Round 4 spec). */
export function useDockCollapsed(botId: string) {
  return useThreadStore(state => (botId in state.dockCollapsed ? state.dockCollapsed[botId] : true))
}

export function useDismissed(botId: string) {
  return useThreadStore(state => state.dismissedByBot[botId] ?? EMPTY_DISMISSED)
}

export function useActiveThread() {
  return useThreadStore(state => state.activeView)
}
