/** Sign-ins in progress (OAuth with PKCE, RFC 7636). Each is known by its `state` value, binds to one sign-in card,
 *  holds the verifier and link in memory only, lasts ten minutes and is spent by the first answer that names it, valid
 *  or not. After a restart every waiting card expires. A new sign-in for a connection voids the one before. */
import { createHash, randomBytes } from 'node:crypto'
import type { AuthServer, OAuthClient } from './mcp-oauth-discovery'

export const SIGN_IN_WINDOW_MS = 10 * 60_000

export interface Flow {
  cardId: string
  connectionId: string
  verifier: string
  /** Built on demand for `connections.signIn.open` only; never persisted, broadcast or logged. */
  link: string
  startedAt: number
  expiresAt: number
  /** Who asked, and from which conversation: it is told when the sign-in ends. */
  botId: string
  chatId: string
}

/** What a sign-in's return address carries. */
export interface SignInReturn {
  code?: string
  state?: string
  iss?: string
  error?: string
}

export class SignInFlows {
  private flows = new Map<string, Flow>()
  constructor(
    private windowMs = SIGN_IN_WINDOW_MS,
    private now: () => number = Date.now
  ) {}

  /** Starts a fresh PKCE flow bound to `cardId`, voiding any earlier flow for `connectionId`. */
  start(
    cardId: string,
    connectionId: string,
    botId: string,
    chatId: string,
    server: AuthServer,
    client: OAuthClient,
    redirectUri: string
  ): { link: string; startedAt: number; expiresAt: number } {
    this.forget(connectionId)
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    const startedAt = this.now()
    const expiresAt = startedAt + this.windowMs
    const url = new URL(server.authorizationEndpoint)
    const params = {
      response_type: 'code',
      client_id: client.clientId,
      redirect_uri: redirectUri,
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: server.resource,
      ...(server.scope ? { scope: server.scope } : {})
    }
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const link = url.href
    this.flows.set(state, { cardId, connectionId, verifier, link, startedAt, expiresAt, botId, chatId })
    return { link, startedAt, expiresAt }
  }

  /** Inspects the live flow `state` names without spending it. Null when absent or expired. */
  peek(state: string | undefined): Flow | null {
    const flow = state ? this.flows.get(state) : undefined
    if (!flow) return null
    return this.now() <= flow.expiresAt ? flow : null
  }

  /** Spends the flow `state` names. Null when there is none, it was spent, or its ten minutes are over. */
  take(state: string | undefined): Flow | null {
    const flow = state ? this.flows.get(state) : undefined
    if (!flow || !state) return null
    this.flows.delete(state)
    return this.now() <= flow.expiresAt ? flow : null
  }

  /** The sign-in URL for `cardId` while its flow is live and unexpired, or null. */
  linkForCard(cardId: string): string | null {
    const now = this.now()
    for (const [state, flow] of this.flows) {
      if (flow.cardId !== cardId) continue
      if (now <= flow.expiresAt) return flow.link
      this.flows.delete(state)
      return null
    }
    return null
  }

  hasCard(cardId: string): boolean {
    return this.linkForCard(cardId) !== null
  }

  purgeExpired() {
    const now = this.now()
    for (const [state, flow] of this.flows) if (now > flow.expiresAt) this.flows.delete(state)
  }

  forgetCard(cardId: string) {
    for (const [state, flow] of this.flows) if (flow.cardId === cardId) this.flows.delete(state)
  }

  forgetBot(botId: string) {
    for (const [state, flow] of this.flows) if (flow.botId === botId) this.flows.delete(state)
  }

  forget(connectionId: string) {
    for (const [state, flow] of this.flows) if (flow.connectionId === connectionId) this.flows.delete(state)
  }
}

/** The parts of an address Oscar's browser ended on. Anything but LilBot's own return address carries nothing. */
export function returnOf(address: string, redirectUri: string): SignInReturn {
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    return {}
  }
  const expected = new URL(redirectUri)
  if (url.origin !== expected.origin || url.pathname !== expected.pathname) return {}
  const read = (name: string) => url.searchParams.get(name) ?? undefined
  return { code: read('code'), state: read('state'), iss: read('iss'), error: read('error') }
}
