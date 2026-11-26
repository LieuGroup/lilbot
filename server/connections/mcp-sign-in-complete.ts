/** Completes an OAuth sign-in flow (automatic Access callback, browser card paste, or legacy bot `finish`),
 *  exchanging the code, probing the service, updating the connection & card state, and notifying the asking chat. */
import type { ConnectionSignInCard } from '../../shared/connections-schema'
import { LilBotError } from '../../shared/lilbot-error'
import { ENGINE_PREFIX } from './mcp-address'
import type { McpConnectionStore, StoredConnection } from './mcp-connection-store'
import type { McpCredentials } from './mcp-credentials'
import { exchangeCode } from './mcp-oauth-tokens'
import { probe } from './mcp-probe'
import { returnOf, type SignInFlows, type SignInReturn } from './mcp-sign-in'
import type { SignInCardService } from './mcp-sign-in-service'

export interface CompletionDeps {
  store: McpConnectionStore
  credentials: McpCredentials
  flows: SignInFlows
  cards: SignInCardService
  redirectUri: string | undefined
  now: () => number
  toolName?: (server: string, tool: string, botId?: string) => string
  changed: () => void
  signedIn: (botId: string, chatId: string, name: string, runId: string) => void
  signInFailed?: (botId: string, chatId: string, name: string, reason: string, runId: string) => void
}

function refused(reason: string): null {
  console.warn(`[connections] sign-in refused: ${reason}`)
  return null
}

/** Spends the flow named by `answer.state` (single-use). When `expectedCardId` is set, refuses without spending any
 *  other card's flow if `state` does not belong to `expectedCardId`. */
export async function completeSignIn(deps: CompletionDeps, answer: SignInReturn, expectedCardId?: string): Promise<StoredConnection | null> {
  deps.cards.reconcile()
  if (expectedCardId) {
    const peeked = deps.flows.peek(answer.state)
    if (!peeked || peeked.cardId !== expectedCardId) return refused('card mismatch')
  }
  const flow = deps.flows.take(answer.state)
  if (!flow) return refused('no valid sign-in')
  return deps.cards.completing(flow.cardId, async () => {
    const fail = (logReason: string, cardReason: string, notify = true) => {
      const failed = deps.cards.markFailed(flow.cardId, cardReason, deps.now())
      if (notify && failed) deps.signInFailed?.(flow.botId, flow.chatId, failed.serviceName, cardReason, `connection-fail-${failed.id}-${failed.settledAt}`)
      return refused(logReason)
    }
    const credential = deps.credentials.get(flow.connectionId)
    if (!credential || !deps.redirectUri) return fail('no valid sign-in', 'This sign-in is no longer available.')
    if (answer.error || !answer.code) return fail('no valid sign-in', 'Sign-in was not completed.')
    if (answer.iss !== undefined ? answer.iss !== credential.server.issuer : credential.server.issRequired) return fail('issuer', 'The sign-in response did not match the service.')
    const tokens = await exchangeCode(credential.server, credential.client, answer.code, flow.verifier, deps.redirectUri, deps.now())
    const connection = deps.store.get(flow.connectionId)
    if (!connection || deps.credentials.get(connection.id)?.client.clientId !== credential.client.clientId)
      return fail('connection changed', 'This connection is no longer waiting for sign-in.', false)
    if (tokens.kind !== 'ok') return fail('token exchange', tokens.kind === 'unreachable' ? 'Could not reach the sign-in service.' : 'The service refused the sign-in.')
    const signedInAt = deps.now()
    deps.credentials.set(connection.id, { ...credential, tokens: tokens.tokens, signedInAt })
    const mapTool = deps.toolName ? (tool: string) => deps.toolName!(`${ENGINE_PREFIX}${connection.name}`, tool, flow.botId) : undefined
    const found = await probe(new URL(connection.address), tokens.tokens.accessToken, mapTool)
    if (!deps.store.get(connection.id) || deps.credentials.get(connection.id)?.client.clientId !== credential.client.clientId) return refused('connection changed')
    if (found.kind === 'ok') deps.store.setTools(connection.id, found.tools)
    deps.store.setState(connection.id, found.kind === 'ok' ? 'connected' : found.kind === 'refused' ? 'sign_in_expired' : 'unreachable')
    deps.changed()
    if (found.kind !== 'ok') return fail('probe failed', found.kind === 'refused' ? 'The service refused the sign-in token.' : 'Signed in, but LilBot could not reach the service.')
    if (!deps.cards.markConnected(flow.cardId, signedInAt)) return refused('card settled')
    deps.signedIn(flow.botId, flow.chatId, connection.name, `connection-${connection.id}-${signedInAt}`)
    return deps.store.get(connection.id)
  })
}

export const hiddenChatSignIn = () =>
  new LilBotError('connection_hidden_chat', 'A sign-in card can only be placed in a conversation with the owner, not a background run or bot-to-bot thread.')

export const connectionNotFound = () => new LilBotError('connection_not_found', 'There is no connection with that id. lilbot_status with area connections lists them.')
export const signInUnavailable = () =>
  new LilBotError('sign_in_unavailable', 'LilBot has no sign-in address (its Access door is not set up), so it cannot sign in to this service. Tell the owner.')
export const signInRefused = () =>
  new LilBotError(
    'sign_in_refused',
    'That address does not finish a sign-in LilBot started in this conversation in the last ten minutes. Ask the owner to paste the full address or ask for a new sign-in card with sign_in.'
  )

/** Browser-only paste completion: binds strictly to `cardId`'s pending flow without spending any other card's flow. */
export async function finishCardPaste(deps: CompletionDeps, cardId: string, address: string): Promise<ConnectionSignInCard> {
  deps.cards.reconcile()
  if (!deps.redirectUri) throw signInUnavailable()
  const card = deps.cards.requireWaiting(cardId)
  const parsed = returnOf(address.trim(), deps.redirectUri)
  const pending = deps.flows.peek(parsed.state)
  if (!pending || pending.cardId !== card.id)
    throw new LilBotError('sign_in_refused', 'That address does not match this sign-in request. Paste the full address your browser landed on, or press Start again.')
  await completeSignIn(deps, parsed, card.id)
  return deps.cards.get(card.id) ?? card
}

/** Tool-result note for a bot after LilBot placed a sign-in card in its conversation. Never includes the link or state. */
export function cardToolReply(connection: StoredConnection, card: ConnectionSignInCard, callbackEnabled: boolean) {
  const where =
    card.providerDomain !== new URL(connection.address).host
      ? `The card shows that the token goes to ${connection.address} and sign-in happens at ${card.providerDomain}.`
      : `The card shows that the token goes to ${connection.address}.`
  const completion = callbackEnabled
    ? 'LilBot notifies you here when the owner finishes (automatically, or by pasting the final address into the card).'
    : "After signing in, the owner's browser will land on a not-found or error page; they can paste that address into the sign-in card."
  return {
    id: connection.id,
    name: connection.name,
    state: connection.state,
    tools: connection.tools,
    cardId: card.id,
    address: connection.address,
    signsInAt: card.providerDomain,
    note: `LilBot placed a sign-in card in this conversation for the owner; it works for ten minutes. ${where} Wait for LilBot to notify you when the owner finishes. ${completion}`
  }
}
