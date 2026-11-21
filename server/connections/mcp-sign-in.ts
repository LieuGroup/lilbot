/** Sign-ins in progress (OAuth with PKCE, RFC 7636). Each is known by its `state` value, holds the verifier the code
 *  needs, lasts ten minutes and is spent by the first answer that names it, valid or not. They live in memory only: after
 *  a restart a bot asks for a new link. A new sign-in for a connection voids the one before. */
import { createHash, randomBytes } from 'node:crypto'
import type { AuthServer, OAuthClient } from './mcp-oauth-discovery'

export const SIGN_IN_WINDOW_MS = 10 * 60_000

export interface Flow {
  connectionId: string
  verifier: string
  startedAt: number
  /** Who asked, and from which conversation: it is told when the sign-in is done. */
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

  /** The link Oscar opens: the service's own sign-in page, asked for a code bound to this flow. */
  start(connectionId: string, botId: string, chatId: string, server: AuthServer, client: OAuthClient, redirectUri: string): string {
    this.forget(connectionId)
    const state = randomBytes(32).toString('base64url')
    const verifier = randomBytes(32).toString('base64url')
    this.flows.set(state, { connectionId, verifier, startedAt: this.now(), botId, chatId })
    const link = new URL(server.authorizationEndpoint)
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
    for (const [key, value] of Object.entries(params)) link.searchParams.set(key, value)
    return link.href
  }

  /** Spends the flow `state` names. Null when there is none, it was spent, or its ten minutes are over. */
  take(state: string | undefined): Flow | null {
    const flow = state ? this.flows.get(state) : undefined
    if (!flow || !state) return null
    this.flows.delete(state)
    return this.now() - flow.startedAt <= this.windowMs ? flow : null
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
