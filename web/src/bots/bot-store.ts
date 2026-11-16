/** The bot list shared by the sidebar and the pages, plus the connection state. */
import { create } from 'zustand'

import { Bot } from '../../../shared/bot-schema'
import { lilbot, messageOf } from '../lilbot-socket'

interface BotStore {
  connected: boolean
  bots: Bot[]
  loaded: boolean
  error: string
  load: () => Promise<void>
  /** Put a created or edited bot into the list without another round trip. */
  upsert: (bot: Bot) => void
}

export const useBotStore = create<BotStore>((set, get) => ({
  connected: false,
  bots: [],
  loaded: false,
  error: '',
  load: async () => {
    try {
      set({ bots: await lilbot.call('bots.list', {}), loaded: true, error: '' })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },
  upsert: bot => {
    // Parsing keeps exactly the roster fields, so a field added to Bot can never be forgotten here.
    const summary = Bot.parse(bot)
    const bots = get().bots
    set({ bots: bots.some(existing => existing.id === summary.id) ? bots.map(existing => (existing.id === summary.id ? summary : existing)) : [...bots, summary] })
  }
}))

/** Start the socket once and reload the bots after every (re)connect. */
export function startConnection() {
  lilbot.onBotsChanged(() => void useBotStore.getState().load())
  lilbot.onConnection(connected => {
    useBotStore.setState({ connected })
    if (connected) void useBotStore.getState().load()
  })
  lilbot.connect()
}
