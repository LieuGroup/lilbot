/** Pure bot roster store factory with a monotonic load sequence guard so overlapping responses
 *  never overwrite newer server state. Zero React Native/Expo imports so unit tests run directly on Linux. */
import { create } from 'zustand'
import type { Bot, Section } from '../../../shared/bot-schema'
import { messageOf } from '../../../shared/client/socket'

export interface BotRosterSocket {
  call(method: 'bots.list', params: Record<string, never>): Promise<Bot[]>
  call(method: 'sections.list', params: Record<string, never>): Promise<Section[]>
  onBotsChanged?: (listener: () => void) => () => void
}

export interface BotStore {
  bots: Bot[]
  sections: Section[]
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
    loaded: false,
    error: '',
    load: async () => {
      const socket = getSocket()
      if (!socket) return
      const seq = ++loadSeq
      try {
        const [bots, sections] = await Promise.all([socket.call('bots.list', {}), socket.call('sections.list', {})])
        if (seq !== loadSeq) return
        set({ bots, sections, loaded: true, error: '' })
      } catch (error) {
        if (seq !== loadSeq) return
        set({ error: messageOf(error) })
      }
    },
    upsert: bot => {
      const bots = get().bots
      set({ bots: bots.some(existing => existing.id === bot.id) ? bots.map(existing => (existing.id === bot.id ? bot : existing)) : [...bots, bot] })
    }
  }))
}
