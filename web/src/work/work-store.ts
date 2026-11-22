/** Live reads and Oscar's actions for the Work board and Check levels, refreshed on `work.changed` and reconnect. */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { WorkKind, WorkLevels } from '../../../shared/work-check-schema'
import type { WorkBrief, WorkItem, WorkSummary } from '../../../shared/work-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { watchedReads } from '../app/watched-reads'

interface WorkStore {
  brief: WorkBrief | null
  active: WorkSummary[]
  list: WorkSummary[]
  listLoaded: boolean
  items: Record<string, WorkItem>
  byBot: Record<string, WorkSummary[]>
  levels: WorkLevels | null
  error: string
}

export const useWorkStore = create<WorkStore>(() => ({
  brief: null,
  active: [],
  list: [],
  listLoaded: false,
  items: {},
  byBot: {},
  levels: null,
  error: ''
}))

function subscribeWork(load: () => Promise<void>) {
  void load()
  const offWork = lilbot.onWorkChanged(() => void load())
  const offConn = lilbot.onConnection(connected => {
    if (connected) void load()
  })
  return () => {
    offWork()
    offConn()
  }
}

export function useWorkBrief() {
  useEffect(() => {
    const load = async () => {
      try {
        const [brief, active] = await Promise.all([
          lilbot.call('work.brief', {}),
          lilbot.call('work.list', { status: ['open', 'working', 'checking', 'needs_oscar', 'failed'], limit: 200 })
        ])
        useWorkStore.setState({ brief, active, error: '' })
      } catch (error) {
        useWorkStore.setState({ error: messageOf(error) })
      }
    }
    return subscribeWork(load)
  }, [])
  const brief = useWorkStore(state => state.brief)
  const active = useWorkStore(state => state.active)
  const error = useWorkStore(state => state.error)
  return { brief, active, error }
}

export function useWorkList(botId: string | undefined, from: number | undefined) {
  useEffect(() => {
    const load = async () => {
      try {
        const list = await lilbot.call('work.list', { botId: botId || undefined, from, limit: 200 })
        useWorkStore.setState({ list, listLoaded: true, error: '' })
      } catch (error) {
        useWorkStore.setState({ error: messageOf(error) })
      }
    }
    return subscribeWork(load)
  }, [botId, from])
  const list = useWorkStore(state => state.list)
  const loaded = useWorkStore(state => state.listLoaded)
  const error = useWorkStore(state => state.error)
  return { list, loaded, error }
}

export function useWorkItem(itemId: string) {
  useEffect(() => {
    const load = async () => {
      try {
        const item = await lilbot.call('work.open', { itemId })
        useWorkStore.setState(state => ({ items: { ...state.items, [itemId]: item }, error: '' }))
      } catch (error) {
        useWorkStore.setState({ error: messageOf(error) })
      }
    }
    return subscribeWork(load)
  }, [itemId])
  const item = useWorkStore(state => state.items[itemId])
  const error = useWorkStore(state => state.error)
  return { item, error }
}

export function useWorkLevels() {
  useEffect(() => {
    const load = async () => {
      try {
        const levels = await lilbot.call('work.levels.get', {})
        useWorkStore.setState({ levels, error: '' })
      } catch (error) {
        useWorkStore.setState({ error: messageOf(error) })
      }
    }
    return subscribeWork(load)
  }, [])
  const levels = useWorkStore(state => state.levels)
  const error = useWorkStore(state => state.error)
  return { levels, error }
}

const watchBot = watchedReads(
  async botId => {
    try {
      const items = await lilbot.call('work.list', { botId, limit: 200 })
      useWorkStore.setState(state => ({ byBot: { ...state.byBot, [botId]: items } }))
    } catch {
      // Keep last read.
    }
  },
  [listener => lilbot.onWorkChanged(listener)]
)

/** Per-bot work items for conversation Work lines and Thread verification badges. */
export function useBotWorkItems(botId: string): WorkSummary[] | undefined {
  useEffect(() => watchBot(botId), [botId])
  return useWorkStore(state => state.byBot[botId])
}

function saveItem(item: WorkItem) {
  useWorkStore.setState(state => ({ items: { ...state.items, [item.id]: item } }))
  return item
}

export const answerWorkItem = async (itemId: string, answer: string) => saveItem(await lilbot.call('work.answer', { itemId, answer }))
export const passWorkItem = async (itemId: string, note?: string) => saveItem(await lilbot.call('work.pass', { itemId, note: note?.trim() || undefined }))
export const sendBackWorkItem = async (itemId: string, reason: string) => saveItem(await lilbot.call('work.sendBack', { itemId, reason }))
export const dropWorkItem = async (itemId: string, reason: string) => saveItem(await lilbot.call('work.drop', { itemId, reason }))
export const setWorkLevel = async (kind: WorkKind, level: number | null, botId?: string) => {
  const levels = await lilbot.call('work.levels.set', { kind, level, botId })
  useWorkStore.setState({ levels })
  return levels
}
