/** Each bot's exchanges (`threads.list`) and any exchange work items waiting on Oscar (`work.list`), kept fresh by
 *  `threads.changed` and `work.changed` while a line, the dock, a view or the Activity tab shows them. Reloads coalesce
 *  over half a second and cover only the bots on screen. */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { BotThread } from '../../../shared/thread-schema'
import type { WorkSummary } from '../../../shared/work-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'

const collapsedKey = (botId: string) => `lilbot.dock-collapsed.${botId}`

function readCollapsed(botId: string): boolean {
  try {
    return localStorage.getItem(collapsedKey(botId)) === 'collapsed'
  } catch {
    return false
  }
}

function writeCollapsed(botId: string, collapsed: boolean) {
  try {
    localStorage.setItem(collapsedKey(botId), collapsed ? 'collapsed' : 'expanded')
  } catch {
    // Private window: kept in memory for this session.
  }
}

interface ThreadStore {
  byBot: Record<string, BotThread[]>
  /** Why the last read of a bot's exchanges failed; the list read before it stays. */
  errors: Record<string, string>
  /** Open `needs_oscar` work items originating from an exchange, keyed by exchange id. */
  waitingWork: Record<string, WorkSummary>
  /** Dock rows dismissed (or opened) by Oscar, keyed by `${botId}:${threadId}` -> end timestamp at dismissal. */
  dismissed: Record<string, number>
  /** Per-bot dock collapse choice (mirrored to localStorage). */
  dockCollapsed: Record<string, boolean>
}

export const useThreadStore = create<ThreadStore>(() => ({
  byBot: {},
  errors: {},
  waitingWork: {},
  dismissed: {},
  dockCollapsed: {}
}))

const watching = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | undefined
let workTimer: ReturnType<typeof setTimeout> | undefined
let started = false

async function load(botId: string) {
  try {
    const list = await lilbot.call('threads.list', { botId })
    useThreadStore.setState(state => ({ byBot: { ...state.byBot, [botId]: list }, errors: { ...state.errors, [botId]: '' } }))
  } catch (error) {
    useThreadStore.setState(state => ({ errors: { ...state.errors, [botId]: messageOf(error) } }))
  }
}

async function loadWaitingWork() {
  try {
    const items = await lilbot.call('work.list', { status: ['needs_oscar'], limit: 200 })
    const waitingWork: Record<string, WorkSummary> = {}
    for (const item of items) if (item.origin.kind === 'exchange') waitingWork[item.origin.id] = item
    useThreadStore.setState({ waitingWork })
  } catch {
    // Work board may be unavailable on minimal test servers; exchanges still work.
  }
}

function reloadSoon() {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    for (const botId of watching.keys()) void load(botId)
  }, 500)
}

function reloadWorkSoon() {
  if (workTimer) return
  workTimer = setTimeout(() => {
    workTimer = undefined
    if (watching.size > 0) void loadWaitingWork()
  }, 300)
}

function ensureStarted() {
  if (started) return
  started = true
  lilbot.onThreadsChanged(reloadSoon)
  lilbot.onWorkChanged(reloadWorkSoon)
  lilbot.onConnection(connected => {
    if (!connected) return
    reloadSoon()
    reloadWorkSoon()
  })
}

/** The bot's exchanges; undefined until the first read. */
export function useThreads(botId: string) {
  useEffect(() => {
    ensureStarted()
    const firstGlobal = watching.size === 0
    watching.set(botId, (watching.get(botId) ?? 0) + 1)
    if (watching.get(botId) === 1) void load(botId)
    if (firstGlobal) void loadWaitingWork()
    return () => {
      const left = (watching.get(botId) ?? 1) - 1
      if (left > 0) watching.set(botId, left)
      else watching.delete(botId)
    }
  }, [botId])
  return useThreadStore(state => state.byBot[botId])
}

export function useWaitingWork() {
  return useThreadStore(state => state.waitingWork)
}

export function useDockCollapsed(botId: string) {
  return useThreadStore(state => (botId in state.dockCollapsed ? state.dockCollapsed[botId] : readCollapsed(botId)))
}

export function setDockCollapsed(botId: string, collapsed: boolean) {
  writeCollapsed(botId, collapsed)
  useThreadStore.setState(state => ({ dockCollapsed: { ...state.dockCollapsed, [botId]: collapsed } }))
}

export function dismissDockItem(botId: string, threadId: string, stamp: number) {
  const key = `${botId}:${threadId}`
  useThreadStore.setState(state => ({ dismissed: { ...state.dismissed, [key]: stamp } }))
}

/** Oscar stops a running exchange. Reloads immediately so every line, dock and view updates at once. */
export async function stopThread(botId: string, threadId: string) {
  await lilbot.call('threads.cancel', { botId, threadId })
  await Promise.all([load(botId), loadWaitingWork()])
  reloadSoon()
}

/** Oscar answers a `needs_oscar` question on a worker or delegated exchange's work item. */
export async function answerWork(itemId: string, answer: string) {
  await lilbot.call('work.answer', { itemId, answer })
  await loadWaitingWork()
  for (const botId of watching.keys()) void load(botId)
}
