/** Pure bot roster store factory with a monotonic load sequence guard so overlapping responses
 *  never overwrite newer server state. Zero React Native/Expo imports so unit tests run directly on Linux. */
import { create } from 'zustand'
import type { Bot, Section } from '../../../shared/bot-schema'
import { activitySince } from '../../../shared/client/activity/activity-since'
import { messageOf } from '../../../shared/client/socket'

export interface BotRosterSocket {
  call(method: 'bots.list', params: Record<string, never>): Promise<Bot[]>
  call(method: 'sections.list', params: Record<string, never>): Promise<Section[]>
  onBotsChanged?: (listener: () => void) => () => void
}

export interface BotStore {
  bots: Bot[]
  sections: Section[]
  since: Record<string, number>
  loaded: boolean
  error: string
  load: () => Promise<void>
  upsert: (bot: Bot) => void
}

export function createBotStore(getSocket: () => BotRosterSocket | null) {
  let loadSeq = 0
  return create<BotStore>((set, get) => ({
    bots: [],
    sections: [],
    since: {},
    loaded: false,
    error: '',
    load: async () => {
      const socket = getSocket()
      if (!socket) return
      const seq = ++loadSeq
      try {
        const [bots, sections] = await Promise.all([socket.call('bots.list', {}), socket.call('sections.list', {})])
        if (seq !== loadSeq) return
        const prev = get()
        set({ bots, sections, since: activitySince(prev.bots, prev.since, bots, Date.now()), loaded: true, error: '' })
      } catch (error) {
        if (seq !== loadSeq) return
        set({ error: messageOf(error) })
      }
    },
    upsert: bot => {
      const prev = get()
      const bots = prev.bots.some(existing => existing.id === bot.id) ? prev.bots.map(existing => (existing.id === bot.id ? bot : existing)) : [...prev.bots, bot]
      set({ bots, since: activitySince(prev.bots, prev.since, bots, Date.now()) })
    }
  }))
}
