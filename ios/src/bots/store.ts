/** The bot roster and sections, shared by the roster pane and the chat header. */
import { create } from 'zustand'
import type { Bot, Section } from '../../../shared/bot-schema'
import { ensureSocket } from '../connection/lilbot'
import { messageOf } from '../../../shared/client/socket'

interface BotStore {
  connected: boolean
  bots: Bot[]
  sections: Section[]
  loaded: boolean
  error: string
  load: () => Promise<void>
  upsert: (bot: Bot) => void
}

export const useBotStore = create<BotStore>((set, get) => ({
  connected: false,
  bots: [],
  sections: [],
  loaded: false,
  error: '',
  load: async () => {
    const socket = ensureSocket()
    if (!socket) return
    try {
      const [bots, sections] = await Promise.all([socket.call('bots.list', {}), socket.call('sections.list', {})])
      set({ bots, sections, loaded: true, error: '' })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },
  upsert: bot => {
    const bots = get().bots
    set({ bots: bots.some(existing => existing.id === bot.id) ? bots.map(existing => (existing.id === bot.id ? bot : existing)) : [...bots, bot] })
  }
}))

/** Reload the roster whenever the server says bots, preferences or sections changed. */
export function watchRoster() {
  const socket = ensureSocket()
  if (!socket) return () => {}
  return socket.onBotsChanged(() => void useBotStore.getState().load())
}
