/** Pure threads store factory (exchanges, same-bot workers, temporary groups, waiting work, dock prefs, and active view).
 *  Zero React Native/Expo imports so every rule is unit-tested on Linux. */
import { create } from 'zustand'
import { messageOf } from '../../../shared/client/socket'
import { COLLAPSED_PREFIX, DISMISSED_PREFIX, EMPTY_DISMISSED, parseDismissed, pruneDismissed, selectWaitingWork } from '../../../shared/client/threads/waiting-work'
import { type DockStorageAdapter, EMPTY_THREAD_STATE, type ThreadSocket, type ThreadStoreOptions, type ThreadStoreState } from './store-types'

export type { DockStorageAdapter, ThreadSocket, ThreadStoreOptions, ThreadStoreState } from './store-types'

const openKey = (botId: string, threadId: string) => `${botId}:${threadId}`

export function createThreadStore(getSocket: () => ThreadSocket | null, storage?: DockStorageAdapter, options?: ThreadStoreOptions) {
  const threadsMs = options?.threadsDebounceMs ?? 500
  const workMs = options?.workDebounceMs ?? 300
  const store = create<ThreadStoreState>(() => ({ ...EMPTY_THREAD_STATE }))
  const watching = new Map<string, number>()
  const hydratedBots = new Set<string>()
  const botSeq = new Map<string, number>()
  const openSeq = new Map<string, number>()
  let workSeq = 0
  let socketGen = 0
  let socketBound: ThreadSocket | null = null
  let unsubs: (() => void)[] = []
  let threadsTimer: ReturnType<typeof setTimeout> | undefined
  let workTimer: ReturnType<typeof setTimeout> | undefined

  const clearTimers = () => {
    if (threadsTimer) clearTimeout(threadsTimer)
    if (workTimer) clearTimeout(workTimer)
    threadsTimer = undefined
    workTimer = undefined
  }

  const bindSocket = () => {
    const socket = getSocket()
    if (socket === socketBound) return
    for (const off of unsubs) off()
    unsubs = []
    clearTimers()
    socketGen += 1
    botSeq.clear()
    openSeq.clear()
    workSeq = 0
    if (socketBound !== null) {
      hydratedBots.clear()
      store.setState({ ...EMPTY_THREAD_STATE })
    }
    socketBound = socket
    if (!socket) return
    const onConn = (connected: boolean) => (connected ? (reloadThreadsSoon(), reloadWorkSoon()) : clearTimers())
    unsubs.push(socket.onThreadsChanged(reloadThreadsSoon), socket.onWorkChanged(reloadWorkSoon), socket.onConnection(onConn))
  }

  async function loadBot(botId: string) {
    bindSocket()
    const socket = socketBound
    if (!socket?.connected) return
    const gen = socketGen
    const seq = (botSeq.get(botId) ?? 0) + 1
    botSeq.set(botId, seq)
    try {
      const list = await socket.call('threads.list', { botId })
      if (gen !== socketGen || botSeq.get(botId) !== seq) return
      store.setState(s => ({ byBot: { ...s.byBot, [botId]: list }, errors: { ...s.errors, [botId]: '' } }))
    } catch (error) {
      if (gen !== socketGen || botSeq.get(botId) !== seq || !socket.connected) return
      store.setState(s => ({ errors: { ...s.errors, [botId]: messageOf(error) } }))
    }
  }

  async function loadOpen(botId: string, threadId: string) {
    bindSocket()
    const socket = socketBound
    const key = openKey(botId, threadId)
    if (!socket?.connected) return
    const gen = socketGen
    const seq = (openSeq.get(key) ?? 0) + 1
    openSeq.set(key, seq)
    try {
      const thread = await socket.call('threads.open', { botId, threadId })
      if (gen !== socketGen || openSeq.get(key) !== seq) return
      store.setState(s => ({ opened: { ...s.opened, [key]: thread }, openErrors: { ...s.openErrors, [key]: '' } }))
    } catch (error) {
      if (gen !== socketGen || openSeq.get(key) !== seq || !socket.connected) return
      store.setState(s => ({ openErrors: { ...s.openErrors, [key]: messageOf(error) } }))
    }
  }

  async function loadWaitingWork() {
    bindSocket()
    const socket = socketBound
    if (!socket?.connected) return
    const gen = socketGen
    const seq = ++workSeq
    try {
      const items = await socket.call('work.list', { status: ['needs_oscar'], limit: 200 })
      if (gen !== socketGen || workSeq !== seq) return
      store.setState({ waitingWork: selectWaitingWork(items), workLoaded: true })
    } catch {
      // Exchanges and workers stay usable if work board is unavailable on a minimal server.
    }
  }

  async function hydrateBotPrefs(botId: string) {
    if (!storage || hydratedBots.has(botId)) return
    const gen = socketGen
    hydratedBots.add(botId)
    try {
      const [collapsedRaw, dismissedRaw] = await Promise.all([storage.getItem(`${COLLAPSED_PREFIX}${botId}`), storage.getItem(`${DISMISSED_PREFIX}${botId}`)])
      if (gen !== socketGen) return
      store.setState(s => ({
        dockCollapsed: botId in s.dockCollapsed ? s.dockCollapsed : { ...s.dockCollapsed, [botId]: collapsedRaw === null ? true : collapsedRaw === 'collapsed' },
        dismissedByBot: botId in s.dismissedByBot ? s.dismissedByBot : { ...s.dismissedByBot, [botId]: parseDismissed(dismissedRaw) }
      }))
    } catch {}
  }

  function reloadThreadsSoon() {
    if (threadsTimer || !socketBound?.connected) return
    threadsTimer = setTimeout(() => {
      threadsTimer = undefined
      if (!socketBound?.connected) return
      for (const botId of watching.keys()) void loadBot(botId)
      const active = store.getState().activeView
      if (active) void loadOpen(active.botId, active.threadId)
    }, threadsMs)
  }

  function reloadWorkSoon() {
    if (workTimer || !socketBound?.connected) return
    workTimer = setTimeout(() => {
      workTimer = undefined
      if (!socketBound?.connected) return
      if (watching.size > 0 || store.getState().activeView) void loadWaitingWork()
    }, workMs)
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
    bindSocket()
    const socket = socketBound
    if (!socket?.connected) throw new Error('Not connected to LilBot.')
    await socket.call('threads.cancel', { botId, threadId })
    await Promise.all([loadBot(botId), loadWaitingWork(), store.getState().activeView?.threadId === threadId ? loadOpen(botId, threadId) : Promise.resolve()])
    reloadThreadsSoon()
  }

  async function answerWork(itemId: string, answer: string) {
    bindSocket()
    const socket = socketBound
    if (!socket?.connected) throw new Error('Not connected to LilBot.')
    await socket.call('work.answer', { itemId, answer })
    await loadWaitingWork()
    for (const botId of watching.keys()) void loadBot(botId)
    const active = store.getState().activeView
    if (active) void loadOpen(active.botId, active.threadId)
  }

  return { useStore: store, openKey, syncSocket: bindSocket, watchBot, loadBot, loadOpen, loadWaitingWork, openView, closeView, setDockCollapsed, dismissDockItem, stopThread, answerWork }
}
