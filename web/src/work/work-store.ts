/** Live reads and Oscar's actions for the Work board and Check levels, refreshed on `work.changed` and reconnect. */
import { type DependencyList, useEffect, useState } from 'react'
import { create } from 'zustand'
import type { WorkKind, WorkLevels } from '../../../shared/work-check-schema'
import type { WorkBrief, WorkItem, WorkSummary } from '../../../shared/work-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'
import { watchedReads } from '../app/watched-reads'

interface WorkStore {
  brief: WorkBrief | null
  active: WorkSummary[]
  needsOscar: WorkSummary[]
  list: WorkSummary[]
  listLoaded: boolean
  items: Record<string, WorkItem>
  itemErrors: Record<string, string>
  byBot: Record<string, WorkSummary[]>
  levels: WorkLevels | null
}

const useWorkStore = create<WorkStore>(() => ({
  brief: null,
  active: [],
  needsOscar: [],
  list: [],
  listLoaded: false,
  items: {},
  itemErrors: {},
  byBot: {},
  levels: null
}))

/** Subscribes a read to `work.changed` and reconnect, guarded by `lilbot.connected` and a per-effect request sequence. */
function useWorkQuery(run: () => Promise<Partial<WorkStore>>, deps: DependencyList, silent = false) {
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let seq = 0
    const load = async () => {
      const id = ++seq
      try {
        const patch = await run()
        if (!active || id !== seq) return
        useWorkStore.setState(patch)
        if (!silent) setError('')
      } catch (failure) {
        if (!silent && active && id === seq) setError(messageOf(failure))
      }
    }
    if (lilbot.connected) void load()
    const offWork = lilbot.onWorkChanged(() => lilbot.connected && void load())
    const offConn = lilbot.onConnection(connected => connected && void load())
    return () => {
      active = false
      offWork()
      offConn()
    }
  }, deps)
  return error
}

export function useWorkBrief() {
  const error = useWorkQuery(async () => {
    const [brief, active] = await Promise.all([
      lilbot.call('work.brief', {}),
      lilbot.call('work.list', { status: ['open', 'working', 'checking', 'needs_oscar', 'failed'], limit: 200 })
    ])
    return { brief, active }
  }, [])
  return { brief: useWorkStore(s => s.brief), active: useWorkStore(s => s.active), error }
}

export function useWorkList(botId: string | undefined, from: number | undefined) {
  const error = useWorkQuery(async () => {
    const list = await lilbot.call('work.list', { botId: botId || undefined, from, limit: 200 })
    return { list, listLoaded: true }
  }, [botId, from])
  return { list: useWorkStore(s => s.list), loaded: useWorkStore(s => s.listLoaded), error }
}

/** Dedicated `needs_oscar` read for Goals tab counts (never overwrites All work's filtered list). */
export function useNeedsOscarWork(): WorkSummary[] {
  useWorkQuery(async () => ({ needsOscar: await lilbot.call('work.list', { status: ['needs_oscar'], limit: 200 }) }), [], true)
  return useWorkStore(s => s.needsOscar)
}

export function useWorkLevels() {
  const error = useWorkQuery(async () => ({ levels: await lilbot.call('work.levels.get', {}) }), [])
  return { levels: useWorkStore(s => s.levels), error }
}

const watchItem = watchedReads(
  async itemId => {
    if (!lilbot.connected) return
    try {
      const item = await lilbot.call('work.open', { itemId })
      useWorkStore.setState(state => ({
        items: { ...state.items, [itemId]: item },
        itemErrors: { ...state.itemErrors, [itemId]: '' }
      }))
    } catch (failure) {
      useWorkStore.setState(state => ({ itemErrors: { ...state.itemErrors, [itemId]: messageOf(failure) } }))
    }
  },
  [listener => lilbot.onWorkChanged(listener)]
)

export function useWorkItem(itemId: string) {
  useEffect(() => watchItem(itemId), [itemId])
  return { item: useWorkStore(s => s.items[itemId]), error: useWorkStore(s => s.itemErrors[itemId] ?? '') }
}

const watchBot = watchedReads(
  async botId => {
    if (!lilbot.connected) return
    try {
      const items = await lilbot.call('work.list', { botId, limit: 200 })
      useWorkStore.setState(state => ({ byBot: { ...state.byBot, [botId]: items } }))
    } catch {
      // Keep last read.
    }
  },
  [listener => lilbot.onWorkChanged(listener)]
)

/** Per-bot work items for Thread verification badges. */
export function useBotWorkItems(botId: string): WorkSummary[] | undefined {
  useEffect(() => watchBot(botId), [botId])
  return useWorkStore(s => s.byBot[botId])
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
