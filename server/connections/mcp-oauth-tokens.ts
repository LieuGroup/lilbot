/** The two token requests LilBot makes (RFC 6749): a code for tokens at sign-in, and a refresh. Both name the resource
 *  (RFC 8707). Answers are never logged: they hold the tokens, and a refusal may echo what was sent. */

import { boundedFetch, jsonBody, Unreachable } from './mcp-http'
import type { AuthServer, OAuthClient } from './mcp-oauth-discovery'

export interface Tokens {
  accessToken: string
  refreshToken?: string
  /** Milliseconds since the epoch; null when the service did not say. */
  expiresAt: number | null
}

export type TokenAnswer = { kind: 'ok'; tokens: Tokens } | { kind: 'refused' } | { kind: 'unreachable' }

async function tokenRequest(server: AuthServer, client: OAuthClient, fields: Record<string, string>, now: number): Promise<TokenAnswer> {
  const body = new URLSearchParams({ ...fields, resource: server.resource, client_id: client.clientId })
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
  if (client.clientSecret && client.authMethod === 'client_secret_basic')
    headers.authorization = `Basic ${Buffer.from(`${encodeURIComponent(client.clientId)}:${encodeURIComponent(client.clientSecret)}`).toString('base64')}`
  else if (client.clientSecret) body.set('client_secret', client.clientSecret)
  let response: Response
  try {
    response = await boundedFetch(server.tokenEndpoint, { method: 'POST', headers, body })
  } catch (error) {
    if (error instanceof Unreachable) return { kind: 'unreachable' }
    throw error
  }
  if (response.status >= 500) {
    await response.body?.cancel()
    return { kind: 'unreachable' }
  }
  if (!response.ok) await response.body?.cancel()
  const json = response.ok ? await jsonBody(response) : null
  if (typeof json?.access_token !== 'string' || !json.access_token || String(json.token_type ?? '').toLowerCase() !== 'bearer') return { kind: 'refused' }
  const seconds = Number(json.expires_in)
  return {
    kind: 'ok',
    tokens: {
      accessToken: json.access_token,
      ...(typeof json.refresh_token === 'string' && json.refresh_token ? { refreshToken: json.refresh_token } : {}),
      expiresAt: Number.isFinite(seconds) && seconds > 0 ? now + seconds * 1000 : null
    }
  }
}

export const exchangeCode = (server: AuthServer, client: OAuthClient, code: string, verifier: string, redirectUri: string, now: number) =>
  tokenRequest(server, client, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }, now)

/** A service that does not rotate refresh tokens keeps the one it gave. */
export async function refreshTokens(server: AuthServer, client: OAuthClient, refreshToken: string, now: number): Promise<TokenAnswer> {
  const answer = await tokenRequest(server, client, { grant_type: 'refresh_token', refresh_token: refreshToken }, now)
  return answer.kind === 'ok' ? { kind: 'ok', tokens: { refreshToken, ...answer.tokens } } : answer
}
