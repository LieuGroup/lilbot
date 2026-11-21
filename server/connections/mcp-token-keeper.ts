/** Gives LilBot's routes a service's access token, refreshing it first when it is about to expire or the service has
 *  just refused it. One refresh per connection at a time: callers arriving meanwhile wait for the same one. */
import type { McpCredentials } from './mcp-credentials'
import { refreshTokens } from './mcp-oauth-tokens'

/** Refresh this long before the service's own expiry. */
const EARLY_MS = 30_000

export type Usable = { kind: 'ok'; token: string } | { kind: 'none' } | { kind: 'unreachable' }

export class TokenKeeper {
  private refreshing = new Map<string, Promise<Usable>>()
  constructor(
    private credentials: McpCredentials,
    private now: () => number = Date.now
  ) {}

  /** `refused`: the token the service just answered 401 to. `none`: no token can be had without a new sign-in. */
  async token(id: string, refused?: string): Promise<Usable> {
    const tokens = this.credentials.get(id)?.tokens
    if (!tokens) return { kind: 'none' }
    if (refused !== undefined && tokens.accessToken !== refused) return { kind: 'ok', token: tokens.accessToken }
    if (refused === undefined && (tokens.expiresAt === null || tokens.expiresAt - EARLY_MS > this.now())) return { kind: 'ok', token: tokens.accessToken }
    if (!tokens.refreshToken) return { kind: 'none' }
    let run = this.refreshing.get(id)
    if (!run) {
      run = this.refresh(id).finally(() => this.refreshing.delete(id))
      this.refreshing.set(id, run)
    }
    return run
  }

  private async refresh(id: string): Promise<Usable> {
    const credential = this.credentials.get(id)
    if (!credential?.tokens?.refreshToken) return { kind: 'none' }
    const answer = await refreshTokens(credential.server, credential.client, credential.tokens.refreshToken, this.now())
    // The connection may have been removed or signed in again while the request was out.
    const current = this.credentials.get(id)
    if (current?.tokens?.refreshToken !== credential.tokens.refreshToken) return current?.tokens ? { kind: 'ok', token: current.tokens.accessToken } : { kind: 'none' }
    if (answer.kind === 'unreachable') return answer
    if (answer.kind === 'refused') {
      this.credentials.set(id, { server: current.server, client: current.client })
      return { kind: 'none' }
    }
    this.credentials.set(id, { ...current, tokens: answer.tokens })
    return { kind: 'ok', token: answer.tokens.accessToken }
  }
}
