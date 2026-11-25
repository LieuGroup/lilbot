/** Types and empty initial state for the pure iOS threads store (`store-core.ts`). */
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'

export interface ThreadSocket {
  connected: boolean
  call(method: 'threads.list', params: { botId: string }): Promise<BotThread[]>
  call(method: 'threads.open', params: { botId: string; threadId: string }): Promise<BotThread>
  call(method: 'threads.cancel', params: { botId: string; threadId: string }): Promise<unknown>
  call(method: 'work.list', params: { status: ['needs_oscar']; limit: number }): Promise<WorkSummary[]>
  call(method: 'work.answer', params: { itemId: string; answer: string }): Promise<unknown>
  onThreadsChanged(listener: () => void): () => void
  onWorkChanged(listener: () => void): () => void
  onConnection(listener: (connected: boolean) => void): () => void
}

export interface DockStorageAdapter {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
}

export interface ThreadStoreOptions {
  threadsDebounceMs?: number
  workDebounceMs?: number
}

export interface ThreadStoreState {
  byBot: Record<string, BotThread[]>
  opened: Record<string, BotThread>
  errors: Record<string, string>
  openErrors: Record<string, string>
  waitingWork: Record<string, WorkSummary>
  workLoaded: boolean
  dismissedByBot: Record<string, Record<string, number>>
  dockCollapsed: Record<string, boolean>
  activeView: { botId: string; threadId: string } | null
}

export const EMPTY_THREAD_STATE: ThreadStoreState = {
  byBot: {},
  opened: {},
  errors: {},
  openErrors: {},
  waitingWork: {},
  workLoaded: false,
  dismissedByBot: {},
  dockCollapsed: {},
  activeView: null
}
