/** Pure Work board & badge store factory. Zero React Native/Expo imports so unit tests run directly on Linux.
 *  Skips RPCs on closed sockets, coalesces push bursts, reloads once on reconnect, resets cleanly on server
 *  switch (`syncSocket`), and guards per-key replies with monotonic sequence numbers. Counts only `needs_oscar`
 *  work items for the Work tab badge (waiting goals are excluded until Goals screens ship on iOS). */
import { create } from 'zustand'
import { messageOf } from '../../../shared/client/socket'
import type { WorkKind } from '../../../shared/work-check-schema'
import type { WorkItem, WorkStatus } from '../../../shared/work-schema'
import { EMPTY_WORK_STATE, type WorkSocket, type WorkStoreState } from './store-types'

export type { WorkSocket, WorkStoreState }

export const ACTIVE_WORK_STATUSES: WorkStatus[] = ['open', 'working', 'checking', 'needs_oscar', 'failed']

export function createWorkStore(getSocket: () => WorkSocket | null, options?: { pushCoalesceMs?: number }) {
  const coalesceMs = options?.pushCoalesceMs ?? 120
  const store = create<WorkStoreState>(() => ({ ...EMPTY_WORK_STATE }))

  let socketBound: WorkSocket | null = null
  let unbindSocket: (() => void) | null = null
  let socketGen = 0
  let pushTimer: ReturnType<typeof setTimeout> | null = null
  const seqs = { brief: 0, list: 0, levels: 0, badge: 0, items: new Map<string, number>() }
  const watchers = { badge: 0, brief: 0, levels: 0, lists: new Map<string, { botId?: string; from?: number; count: number }>(), items: new Map<string, number>() }

  const clearPushTimer = () => {
    if (!pushTimer) return
    clearTimeout(pushTimer)
    pushTimer = null
  }

  const saveItem = (item: WorkItem) => {
    store.setState(prev => ({ items: { ...prev.items, [item.id]: item }, itemErrors: { ...prev.itemErrors, [item.id]: '' } }))
    return item
  }

  const guarded = async <T>(key: 'brief' | 'list' | 'levels' | 'badge', run: (socket: WorkSocket) => Promise<T>, onOk: (val: T) => void, onErr?: (msg: string) => void) => {
    const socket = socketBound
    if (!socket?.connected) return
    const gen = socketGen
    const seq = ++seqs[key]
    try {
      const value = await run(socket)
      if (gen === socketGen && seq === seqs[key]) onOk(value)
    } catch (error) {
      if (gen === socketGen && seq === seqs[key] && socket.connected) onErr?.(messageOf(error))
    }
  }

  const refreshBadge = () => guarded('badge', s => s.call('work.list', { status: ['needs_oscar'], limit: 100 }), waiting => store.setState({ badgeCount: waiting.length }))
  const loadBrief = () =>
    guarded(
      'brief',
      s => Promise.all([s.call('work.brief', {}), s.call('work.list', { status: ACTIVE_WORK_STATUSES, limit: 200 })]),
      ([brief, active]) => store.setState({ brief, active, briefError: '' }),
      briefError => store.setState({ briefError })
    )
  const loadList = (botId: string | undefined, from: number | undefined) =>
    guarded('list', s => s.call('work.list', { botId, from, limit: 200 }), list => store.setState({ list, listLoaded: true, listError: '' }), listError => store.setState({ listError }))
  const loadLevels = () => guarded('levels', s => s.call('work.levels.get', {}), levels => store.setState({ levels, levelsError: '' }), levelsError => store.setState({ levelsError }))

  const loadItem = async (itemId: string) => {
    const socket = socketBound
    if (!socket?.connected) return
    const gen = socketGen
    const seq = (seqs.items.get(itemId) ?? 0) + 1
    seqs.items.set(itemId, seq)
    try {
      const item = await socket.call('work.open', { itemId })
      if (gen === socketGen && seqs.items.get(itemId) === seq) saveItem(item)
    } catch (error) {
      if (gen === socketGen && seqs.items.get(itemId) === seq && socket.connected) {
        store.setState(prev => ({ itemErrors: { ...prev.itemErrors, [itemId]: messageOf(error) } }))
      }
    }
  }

  const reloadWatched = () => {
    if (!socketBound?.connected) return
    if (watchers.badge > 0) void refreshBadge()
    if (watchers.brief > 0) void loadBrief()
    if (watchers.levels > 0) void loadLevels()
    for (const entry of watchers.lists.values()) void loadList(entry.botId, entry.from)
    for (const itemId of watchers.items.keys()) void loadItem(itemId)
  }

  const schedulePushReload = () => {
    if (!socketBound?.connected || pushTimer) return
    pushTimer = setTimeout(() => {
      pushTimer = null
      reloadWatched()
    }, coalesceMs)
  }

  function syncSocket() {
    const next = getSocket()
    if (next === socketBound) return
    unbindSocket?.()
    unbindSocket = null
    clearPushTimer()
    const hadSocket = socketBound !== null
    socketBound = next
    socketGen++
    seqs.brief = seqs.list = seqs.levels = seqs.badge = 0
    seqs.items.clear()
    if (hadSocket) store.setState({ ...EMPTY_WORK_STATE })
    if (!next) return
    const offWork = next.onWorkChanged(schedulePushReload)
    const offConn = next.onConnection(connected => (connected ? reloadWatched() : clearPushTimer()))
    unbindSocket = () => {
      offWork()
      offConn()
    }
    if (next.connected) reloadWatched()
  }

  const requireSocket = () => {
    syncSocket()
    if (!socketBound?.connected) throw new Error('Not connected to LilBot.')
    return socketBound
  }

  const mutateItem = async (call: (socket: WorkSocket) => Promise<WorkItem>) => {
    const socket = requireSocket()
    const gen = socketGen
    const item = await call(socket)
    if (gen !== socketGen) return item
    saveItem(item)
    void refreshBadge()
    return item
  }

  const watchCount = (key: 'badge' | 'brief' | 'levels', load: () => Promise<void>) => {
    syncSocket()
    watchers[key]++
    if (socketBound?.connected) void load()
    return () => {
      watchers[key] = Math.max(0, watchers[key] - 1)
    }
  }

  const watchList = (botId: string | undefined, from: number | undefined) => {
    syncSocket()
    const key = `${botId ?? ''}|${from ?? ''}`
    watchers.lists.set(key, { botId, from, count: (watchers.lists.get(key)?.count ?? 0) + 1 })
    if (socketBound?.connected) void loadList(botId, from)
    return () => {
      const cur = watchers.lists.get(key)
      if (!cur || cur.count <= 1) watchers.lists.delete(key)
      else watchers.lists.set(key, { ...cur, count: cur.count - 1 })
    }
  }

  const watchItem = (itemId: string) => {
    syncSocket()
    watchers.items.set(itemId, (watchers.items.get(itemId) ?? 0) + 1)
    if (socketBound?.connected) void loadItem(itemId)
    return () => {
      const next = (watchers.items.get(itemId) ?? 1) - 1
      if (next <= 0) watchers.items.delete(itemId)
      else watchers.items.set(itemId, next)
    }
  }

  return {
    useStore: store,
    syncSocket,
    refreshBadge,
    loadBrief,
    loadList,
    loadItem,
    loadLevels,
    answerWorkItem: (itemId: string, answer: string) => mutateItem(s => s.call('work.answer', { itemId, answer })),
    passWorkItem: (itemId: string, note?: string) => mutateItem(s => s.call('work.pass', { itemId, note: note?.trim() || undefined })),
    sendBackWorkItem: (itemId: string, reason: string) => mutateItem(s => s.call('work.sendBack', { itemId, reason })),
    dropWorkItem: (itemId: string, reason: string) => mutateItem(s => s.call('work.drop', { itemId, reason })),
    setWorkLevel: async (kind: WorkKind, level: number | null, botId?: string) => {
      const socket = requireSocket()
      const gen = socketGen
      const levels = await socket.call('work.levels.set', { kind, level, botId })
      if (gen === socketGen) store.setState({ levels, levelsError: '' })
      return levels
    },
    watchBadge: () => watchCount('badge', refreshBadge),
    watchBrief: () => watchCount('brief', loadBrief),
    watchLevels: () => watchCount('levels', loadLevels),
    watchList,
    watchItem
  }
}
