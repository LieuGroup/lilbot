/** The bot roster and sections, shared by the roster pane and the chat header. */
import { ensureSocket } from '../connection/lilbot'
import { type BotRosterSocket, createBotStore } from './store-core'

export const useBotStore = createBotStore(() => ensureSocket() as BotRosterSocket | null)

/** Reload the roster whenever the server says bots, preferences or sections changed. */
export function watchRoster() {
  const socket = ensureSocket()
  if (!socket) return () => {}
  return socket.onBotsChanged(() => void useBotStore.getState().load())
}
