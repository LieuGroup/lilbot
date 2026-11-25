/** Pure threads store factory (exchanges, same-bot workers, temporary groups, waiting work, dock prefs, and active view).
 *  Zero React Native/Expo imports so every rule is unit-tested on Linux. */
import { create } from 'zustand'
import { messageOf } from '../../../shared/client/socket'
import { COLLAPSED_PREFIX, DISMISSED_PREFIX, EMPTY_DISMISSED, parseDismissed, pruneDismissed, selectWaitingWork } from '../../../shared/client/threads/waiting-work'
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

export interface ThreadStoreState {
  byBot: Record<string, BotThread[]>
  opened: Record<string, BotThread>
  errors: Record<string, string>
  openErrors: Record<string, string>
  waitingWork: Record<string, WorkSummary>
  dismissedByBot: Record<string, Record<string, number>>
  /** Per-bot dock collapse state; defaults to `true` (32 pt floating glass pill) on mobile per Round 4 spec. */
  dockCollapsed: Record<string, boolean>
  activeView: { botId: string; threadId: string } | null
}

const openKey = (botId: string, threadId: string) => `${botId}:${threadId}`

export function createThreadStore(getSocket: () => ThreadSocket | null, storage?: DockStorageAdapter) {
  const store = create<ThreadStoreState>(() => ({
    byBot: {},
    opened: {},
    errors: {},
    openErrors: {},
    waitingWork: {},
    dismissedByBot: {},
    dockCollapsed: {},
    activeView: null
  }))

  const watching = new Map<string, number>()
  const hydratedBots = new Set<string>()
  let socketBound: ThreadSocket | null = null
  let unsubs: (() => void)[] = []
  let threadsTimer: ReturnType<typeof setTimeout> | undefined
  let workTimer: ReturnType<typeof setTimeout> | undefined

  async function loadBot(botId: string) {
    const socket = getSocket()
    if (!socket) return
    try {
      const list = await socket.call('threads.list', { botId })
      store.setState(s => ({ byBot: { ...s.byBot, [botId]: list }, errors: { ...s.errors, [botId]: '' } }))
    } catch (error) {
      store.setState(s => ({ errors: { ...s.errors, [botId]: messageOf(error) } }))
    }
  }

  async function loadOpen(botId: string, threadId: string) {
    const socket = getSocket()
    const key = openKey(botId, threadId)
    if (!socket) return
    try {
      const thread = await socket.call('threads.open', { botId, threadId })
      store.setState(s => ({ opened: { ...s.opened, [key]: thread }, openErrors: { ...s.openErrors, [key]: '' } }))
    } catch (error) {
      store.setState(s => ({ openErrors: { ...s.openErrors, [key]: messageOf(error) } }))
    }
  }

  async function loadWaitingWork() {
    const socket = getSocket()
    if (!socket) return
    try {
      const items = await socket.call('work.list', { status: ['needs_oscar'], limit: 200 })
      store.setState({ waitingWork: selectWaitingWork(items) })
    } catch {
      // Exchanges and workers stay usable if work board is unavailable on a minimal server.
    }
  }

  async function hydrateBotPrefs(botId: string) {
    if (!storage || hydratedBots.has(botId)) return
    hydratedBots.add(botId)
    try {
      const [collapsedRaw, dismissedRaw] = await Promise.all([storage.getItem(`${COLLAPSED_PREFIX}${botId}`), storage.getItem(`${DISMISSED_PREFIX}${botId}`)])
      store.setState(s => ({
        dockCollapsed: botId in s.dockCollapsed ? s.dockCollapsed : { ...s.dockCollapsed, [botId]: collapsedRaw === null ? true : collapsedRaw === 'collapsed' },
        dismissedByBot: botId in s.dismissedByBot ? s.dismissedByBot : { ...s.dismissedByBot, [botId]: parseDismissed(dismissedRaw) }
      }))
    } catch {
      // Keep default in-memory state if storage fails.
    }
  }

  const reloadThreadsSoon = () => {
    if (threadsTimer) return
    threadsTimer = setTimeout(() => {
      threadsTimer = undefined
      for (const botId of watching.keys()) void loadBot(botId)
      const active = store.getState().activeView
      if (active) void loadOpen(active.botId, active.threadId)
    }, 500)
  }

  const reloadWorkSoon = () => {
    if (workTimer) return
    workTimer = setTimeout(() => {
      workTimer = undefined
      if (watching.size > 0 || store.getState().activeView) void loadWaitingWork()
    }, 300)
  }

  const bindSocket = () => {
    const socket = getSocket()
    if (socket === socketBound) return
    for (const off of unsubs) off()
    unsubs = []
    socketBound = socket
    if (!socket) return
    const onReconnect = (connected: boolean) => connected && (reloadThreadsSoon(), reloadWorkSoon())
    unsubs.push(socket.onThreadsChanged(reloadThreadsSoon), socket.onWorkChanged(reloadWorkSoon), socket.onConnection(onReconnect))
  }

  const watchBot = (botId: string) => {
    bindSocket()
    const firstGlobal = watching.size === 0
    const nextCount = (watching.get(botId) ?? 0) + 1
    watching.set(botId, nextCount)
    void hydrateBotPrefs(botId)
    if (nextCount === 1) void loadBot(botId)
    if (firstGlobal) void loadWaitingWork()
    return () => {
      const left = (watching.get(botId) ?? 1) - 1
      if (left > 0) watching.set(botId, left)
      else watching.delete(botId)
    }
  }

  const openView = (botId: string, threadId: string) => {
    bindSocket()
    store.setState({ activeView: { botId, threadId } })
    void loadOpen(botId, threadId)
    void loadWaitingWork()
  }

  const closeView = () => store.setState({ activeView: null })

  const setDockCollapsed = (botId: string, collapsed: boolean) => {
    store.setState(s => ({ dockCollapsed: { ...s.dockCollapsed, [botId]: collapsed } }))
    void storage?.setItem(`${COLLAPSED_PREFIX}${botId}`, collapsed ? 'collapsed' : 'expanded').catch(() => {})
  }

  const dismissDockItem = (botId: string, threadId: string, stamp: number) => {
    let pruned: Record<string, number> = EMPTY_DISMISSED
    store.setState(s => {
      pruned = pruneDismissed({ ...(s.dismissedByBot[botId] ?? EMPTY_DISMISSED), [threadId]: stamp })
      return { dismissedByBot: { ...s.dismissedByBot, [botId]: pruned } }
    })
    void storage?.setItem(`${DISMISSED_PREFIX}${botId}`, JSON.stringify(pruned)).catch(() => {})
  }

  async function stopThread(botId: string, threadId: string) {
    const socket = getSocket()
    if (!socket) throw new Error('Not connected to LilBot.')
    await socket.call('threads.cancel', { botId, threadId })
    await Promise.all([loadBot(botId), loadWaitingWork(), store.getState().activeView?.threadId === threadId ? loadOpen(botId, threadId) : Promise.resolve()])
    reloadThreadsSoon()
  }

  async function answerWork(itemId: string, answer: string) {
    const socket = getSocket()
    if (!socket) throw new Error('Not connected to LilBot.')
    await socket.call('work.answer', { itemId, answer })
    await loadWaitingWork()
    for (const botId of watching.keys()) void loadBot(botId)
    const active = store.getState().activeView
    if (active) void loadOpen(active.botId, active.threadId)
  }

  return { useStore: store, openKey, watchBot, loadBot, loadOpen, loadWaitingWork, openView, closeView, setDockCollapsed, dismissDockItem, stopThread, answerWork }
}
