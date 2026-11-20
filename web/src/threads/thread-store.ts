/** Each bot's exchanges with other bots (`threads.list`), kept fresh by `threads.changed` while a line, a view or the Activity
 *  tab shows them. The push names no bot and comes with every tool call in an exchange, so reloads wait half a second and
 *  cover only the bots on screen. */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { BotThread } from '../../../shared/thread-schema'
import { lilbot, messageOf } from '../app/lilbot-socket'

interface ThreadStore {
  byBot: Record<string, BotThread[]>
  /** Why the last read of a bot's exchanges failed; the list read before it stays. */
  errors: Record<string, string>
}

export const useThreadStore = create<ThreadStore>(() => ({ byBot: {}, errors: {} }))
const watching = new Map<string, number>()
let timer: ReturnType<typeof setTimeout> | undefined
let started = false

async function load(botId: string) {
  try {
    const list = await lilbot.call('threads.list', { botId })
    useThreadStore.setState(state => ({ byBot: { ...state.byBot, [botId]: list }, errors: { ...state.errors, [botId]: '' } }))
  } catch (error) {
    useThreadStore.setState(state => ({ errors: { ...state.errors, [botId]: messageOf(error) } }))
  }
}

function reloadSoon() {
  if (timer) return
  timer = setTimeout(() => {
    timer = undefined
    for (const botId of watching.keys()) void load(botId)
  }, 500)
}

/** The bot's exchanges, newest first; undefined until the first read. */
export function useThreads(botId: string) {
  useEffect(() => {
    if (!started) {
      started = true
      lilbot.onThreadsChanged(reloadSoon)
      lilbot.onConnection(connected => {
        if (connected) reloadSoon()
      })
    }
    watching.set(botId, (watching.get(botId) ?? 0) + 1)
    if (watching.get(botId) === 1) void load(botId)
    return () => {
      const left = (watching.get(botId) ?? 1) - 1
      if (left > 0) watching.set(botId, left)
      else watching.delete(botId)
    }
  }, [botId])
  return useThreadStore(state => state.byBot[botId])
}

/** Oscar stops a running exchange. Both bots' lists are read again, so every line and view shows it at once. */
export async function stopThread(botId: string, threadId: string) {
  await lilbot.call('threads.cancel', { botId, threadId })
  reloadSoon()
}
