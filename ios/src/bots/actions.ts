/** Roster and bot management actions wired to the iOS socket and stores. */
import { ensureSocket } from '../connection/lilbot'
import { type BotActionsSocket, createBotActions } from './actions-core'
import { useBotMenuStore } from './menu-store'
import { useBotStore } from './store'

const defaultActions = createBotActions({
  getSocket: () => ensureSocket() as BotActionsSocket | null,
  reload: () => useBotStore.getState().load(),
  upsert: bot => useBotStore.getState().upsert(bot),
  setError: message => useBotMenuStore.getState().setError(message)
})

export const { setBotPrefs, setBotUnread, makeBotPrimary, moveToNewSection, saveNameAndAvatar, createBot, deleteBot } = defaultActions
