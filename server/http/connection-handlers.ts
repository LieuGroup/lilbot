/** Oscar's browser methods for connections and in-chat sign-in cards (#216). Only reachable over Oscar's browser WebSocket,
 *  never from bots or the helper door. */
import type { ConnectionSignInCard, ConnectionsStatus } from '../../shared/connections-schema'
import type { Method } from '../../shared/protocol'
import type { Handlers } from './browser-session'

export interface BrowserConnections {
  status: () => ConnectionsStatus
  ready: (botId: string, chatId: string) => Promise<void>
  reconcile?: () => void
  openSignIn: (cardId: string) => { url: string }
  finishSignIn: (cardId: string, address: string) => Promise<ConnectionSignInCard>
  cancelSignIn: (cardId: string) => ConnectionSignInCard
  restartSignIn: (cardId: string) => Promise<ConnectionSignInCard>
}

type ConnectionMethod = Extract<Method, `connections.${string}`>

export function connectionHandlers(connections: () => BrowserConnections): Pick<Handlers, ConnectionMethod> {
  return {
    'connections.status': async () => connections().status(),
    'connections.signIn.open': async ({ cardId }) => connections().openSignIn(cardId),
    'connections.signIn.finish': ({ cardId, address }) => connections().finishSignIn(cardId, address),
    'connections.signIn.cancel': async ({ cardId }) => connections().cancelSignIn(cardId),
    'connections.signIn.restart': ({ cardId }) => connections().restartSignIn(cardId)
  }
}
