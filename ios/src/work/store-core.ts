/** Pure Work board & badge store factory. Zero React Native/Expo imports so unit tests run directly on Linux.
 *  Counts only `needs_oscar` work items for the Work tab badge (waiting goals are excluded until Goals screens ship on iOS). */
import { create } from 'zustand'
import { messageOf } from '../../../shared/client/socket'
import type { WorkKind, WorkLevels } from '../../../shared/work-check-schema'
import type { WorkBrief, WorkItem, WorkStatus, WorkSummary } from '../../../shared/work-schema'

export interface WorkSocket {
  connected: boolean
  call(method: 'work.brief', params: { since?: number }): Promise<WorkBrief>
  call(method: 'work.list', params: { botId?: string; status?: WorkStatus[]; from?: number; to?: number; limit?: number }): Promise<WorkSummary[]>
  call(method: 'work.open', params: { itemId: string }): Promise<WorkItem>
  call(method: 'work.answer', params: { itemId: string; answer: string }): Promise<WorkItem>
  call(method: 'work.pass', params: { itemId: string; note?: string }): Promise<WorkItem>
  call(method: 'work.sendBack', params: { itemId: string; reason: string }): Promise<WorkItem>
  call(method: 'work.drop', params: { itemId: string; reason: string }): Promise<WorkItem>
  call(method: 'work.levels.get', params: Record<string, never>): Promise<WorkLevels>
  call(method: 'work.levels.set', params: { kind: WorkKind; botId?: string; level: number | null }): Promise<WorkLevels>
  onWorkChanged(listener: () => void): () => void
  onConnection(listener: (connected: boolean) => void): () => void
}

export interface WorkStoreState {
  brief: WorkBrief | null
  active: WorkSummary[]
  briefError: string
  list: WorkSummary[]
  listLoaded: boolean
  listError: string
  items: Record<string, WorkItem>
  itemErrors: Record<string, string>
  levels: WorkLevels | null
  levelsError: string
  /** Count of actionable `needs_oscar` work items for the Work tab badge (excludes waiting goals until Goals ships). */
  badgeCount: number
}

export function createWorkStore(getSocket: () => WorkSocket | null) {
  const store = create<WorkStoreState>(() => ({
    brief: null,
    active: [],
    briefError: '',
    list: [],
    listLoaded: false,
    listError: '',
    items: {},
    itemErrors: {},
    levels: null,
    levelsError: '',
    badgeCount: 0
  }))

  let briefSeq = 0
  let listSeq = 0
  let levelsSeq = 0
  let badgeSeq = 0
  const itemSeqs = new Map<string, number>()

  const saveItem = (item: WorkItem) => {
    store.setState(s => ({ items: { ...s.items, [item.id]: item }, itemErrors: { ...s.itemErrors, [item.id]: '' } }))
    return item
  }

  async function refreshBadge() {
    const socket = getSocket()
    if (!socket?.connected) return
    const seq = ++badgeSeq
    try {
      const items = await socket.call('work.list', { status: ['needs_oscar'], limit: 200 })
      if (seq !== badgeSeq) return
      store.setState({ badgeCount: items.length })
    } catch {
      // Keep last known badge count on transient disconnect.
    }
  }

  async function loadBrief() {
    const socket = getSocket()
    if (!socket?.connected) return
    const seq = ++briefSeq
    try {
      const [brief, active] = await Promise.all([
        socket.call('work.brief', {}),
        socket.call('work.list', { status: ['open', 'working', 'checking', 'needs_oscar', 'failed'], limit: 200 })
      ])
      if (seq !== briefSeq) return
      store.setState({ brief, active, briefError: '', badgeCount: brief.needsOscar.length })
    } catch (error) {
      if (seq !== briefSeq) return
      store.setState({ briefError: messageOf(error) })
    }
  }

  async function loadList(botId: string | undefined, from: number | undefined) {
    const socket = getSocket()
    if (!socket?.connected) return
    const seq = ++listSeq
    try {
      const list = await socket.call('work.list', { botId: botId || undefined, from, limit: 200 })
      if (seq !== listSeq) return
      store.setState({ list, listLoaded: true, listError: '' })
    } catch (error) {
      if (seq !== listSeq) return
      store.setState({ listError: messageOf(error) })
    }
  }

  async function loadItem(itemId: string) {
    const socket = getSocket()
    if (!socket?.connected) return
    const seq = (itemSeqs.get(itemId) ?? 0) + 1
    itemSeqs.set(itemId, seq)
    try {
      const item = await socket.call('work.open', { itemId })
      if (itemSeqs.get(itemId) !== seq) return
      saveItem(item)
    } catch (error) {
      if (itemSeqs.get(itemId) !== seq) return
      store.setState(s => ({ itemErrors: { ...s.itemErrors, [itemId]: messageOf(error) } }))
    }
  }

  async function loadLevels() {
    const socket = getSocket()
    if (!socket?.connected) return
    const seq = ++levelsSeq
    try {
      const levels = await socket.call('work.levels.get', {})
      if (seq !== levelsSeq) return
      store.setState({ levels, levelsError: '' })
    } catch (error) {
      if (seq !== levelsSeq) return
      store.setState({ levelsError: messageOf(error) })
    }
  }

  const requireSocket = () => {
    const socket = getSocket()
    if (!socket) throw new Error('Not connected to LilBot.')
    return socket
  }

  const answerWorkItem = async (itemId: string, answer: string) => {
    const item = saveItem(await requireSocket().call('work.answer', { itemId, answer }))
    void refreshBadge()
    return item
  }

  const passWorkItem = async (itemId: string, note?: string) => {
    const item = saveItem(await requireSocket().call('work.pass', { itemId, note: note?.trim() || undefined }))
    void refreshBadge()
    return item
  }

  const sendBackWorkItem = async (itemId: string, reason: string) => {
    const item = saveItem(await requireSocket().call('work.sendBack', { itemId, reason }))
    void refreshBadge()
    return item
  }

  const dropWorkItem = async (itemId: string, reason: string) => {
    const item = saveItem(await requireSocket().call('work.drop', { itemId, reason }))
    void refreshBadge()
    return item
  }

  const setWorkLevel = async (kind: WorkKind, level: number | null, botId?: string) => {
    const levels = await requireSocket().call('work.levels.set', { kind, level, botId })
    store.setState({ levels, levelsError: '' })
    return levels
  }

  function watchBadge() {
    const socket = getSocket()
    if (!socket) return () => {}
    if (socket.connected) void refreshBadge()
    const offWork = socket.onWorkChanged(() => void refreshBadge())
    const offConn = socket.onConnection(connected => connected && void refreshBadge())
    return () => {
      offWork()
      offConn()
    }
  }

  return { useStore: store, refreshBadge, loadBrief, loadList, loadItem, loadLevels, answerWorkItem, passWorkItem, sendBackWorkItem, dropWorkItem, setWorkLevel, watchBadge }
}
