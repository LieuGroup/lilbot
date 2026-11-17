/** Signs LilBot in to T3 Code's MCP server with one pairing code Oscar created in T3 Code.
 *
 *  T3's documented MCP sign-in is OAuth with PKCE. The approval page accepts a pairing code
 *  (`/oauth/mcp/decision`) and answers with the redirect as JSON, so the whole exchange runs
 *  here without a browser or a callback listener. Authorization codes live 60 seconds, so the
 *  steps run back to back, all against the same origin (T3 derives issuer and resource from it). */
import { createHash, randomBytes } from 'node:crypto'
import { networkInterfaces } from 'node:os'
import { LilBotError } from '../../shared/protocol'
import type { T3Grant } from './t3-grant'

/** Loopback redirects are accepted on any port and never visited: the redirect comes back as JSON. */
const REDIRECT_URI = 'http://127.0.0.1/lilbot/t3/callback'
/** Every scope T3 gives a Full access sign-in. */
const FULL_ACCESS_SCOPES = ['orchestration:read', 'orchestration:operate', 'settings:write', 'source-control:write']
const LOWER_LEVEL_CODE = /^(READ|SUPERVISED|EDITS|AUTO)-/i

const base64url = (bytes: Buffer) => bytes.toString('base64url')

async function call(fetcher: typeof fetch, url: string, init: RequestInit, step: string): Promise<any> {
  let response: Response
  try {
    response = await fetcher(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
  } catch {
    throw new LilBotError('t3_unreachable', `T3 Code did not answer (${step}). Is it running on this machine?`)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    // T3's approval errors are written for people ("That pairing code is unknown, expired, or already used.").
    const message = typeof body?.message === 'string' ? body.message : typeof body?.error_description === 'string' ? body.error_description : `HTTP ${response.status}`
    throw new LilBotError('t3_sign_in_failed', `T3 Code refused the sign-in (${step}): ${message}`)
  }
  return body
}

/** A pairing link (`https://…/pair#token=…`) carries its code in `token`; T3's Copy link gives that. */
export function pairingCode(pasted: string): string {
  const text = pasted.trim()
  if (!/^https?:\/\//i.test(text)) return text
  try {
    const url = new URL(text)
    return (new URLSearchParams(url.hash.slice(1)).get('token') ?? url.searchParams.get('token') ?? '').trim()
  } catch {
    return ''
  }
}

/** The host of a pasted pairing link that does not point at this machine, if any. */
export function linkFromAnotherMachine(pasted: string, addresses = localAddresses()): string | undefined {
  if (!/^https?:\/\//i.test(pasted.trim())) return undefined
  try {
    const host = new URL(pasted.trim()).hostname
    return /^\d+\.\d+\.\d+\.\d+$/.test(host) && !addresses.includes(host) ? host : undefined
  } catch {
    return undefined
  }
}
const localAddresses = () =>
  Object.values(networkInterfaces())
    .flat()
    .map(entry => entry?.address ?? '')

export async function signInToT3(input: { mcpUrl: string; code: string; label: string; fetch?: typeof fetch; now?: () => number }): Promise<T3Grant> {
  const fetcher = input.fetch ?? fetch
  const now = input.now ?? Date.now
  const code = pairingCode(input.code)
  const foreign = linkFromAnotherMachine(input.code)
  if (foreign) throw new LilBotError('invalid_code', `That pairing link was made on another T3 Code environment (${foreign}). Create it on this machine’s environment instead.`)
  if (!code || code.length > 200 || /\s/.test(code)) throw new LilBotError('invalid_code', 'Paste the pairing code exactly as T3 Code shows it.')
  if (LOWER_LEVEL_CODE.test(code)) throw new LilBotError('invalid_code', 'This code approves less than Full access. Create a code with Full access.')
  const resource = new URL(input.mcpUrl)
  const origin = resource.origin
  const metadata = await call(fetcher, `${origin}/.well-known/oauth-authorization-server`, {}, 'discovery')
  for (const key of ['registration_endpoint', 'token_endpoint'] as const) {
    if (typeof metadata?.[key] !== 'string' || new URL(metadata[key]).origin !== origin) throw new LilBotError('t3_sign_in_failed', 'T3 Code’s sign-in settings look wrong.')
  }
  const client = await call(
    fetcher,
    metadata.registration_endpoint,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: input.label, redirect_uris: [REDIRECT_URI] }) },
    'registration'
  )
  const verifier = base64url(randomBytes(48))
  const state = base64url(randomBytes(24))
  const authorization = {
    response_type: 'code',
    client_id: String(client.client_id),
    redirect_uri: REDIRECT_URI,
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
    state,
    resource: `${origin}${resource.pathname}`
  }
  const decision = await call(
    fetcher,
    `${origin}/oauth/mcp/decision`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ authorization, decision: { _tag: 'pairing-code', access: 'full-access', code } })
    },
    'approval'
  )
  const redirect = new URL(String(decision?.redirectTo ?? ''), REDIRECT_URI)
  if (redirect.searchParams.get('state') !== state) throw new LilBotError('t3_sign_in_failed', 'T3 Code answered a different sign-in.')
  if (redirect.searchParams.get('iss') && redirect.searchParams.get('iss') !== metadata.issuer) throw new LilBotError('t3_sign_in_failed', 'T3 Code answered from another issuer.')
  const authCode = redirect.searchParams.get('code')
  if (!authCode) throw new LilBotError('t3_sign_in_failed', `T3 Code did not approve the sign-in (${redirect.searchParams.get('error') ?? 'no code'}).`)
  const token = await call(
    fetcher,
    metadata.token_endpoint,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authCode,
        redirect_uri: REDIRECT_URI,
        client_id: authorization.client_id,
        code_verifier: verifier,
        resource: authorization.resource
      })
    },
    'token'
  )
  if (typeof token?.access_token !== 'string' || typeof token.expires_in !== 'number') throw new LilBotError('t3_sign_in_failed', 'T3 Code returned no usable sign-in.')
  const scopes = String(token.scope ?? '').split(/\s+/)
  if (!FULL_ACCESS_SCOPES.every(scope => scopes.includes(scope)))
    throw new LilBotError('insufficient_access', 'T3 Code approved less than Full access. Revoke this sign-in in Sharing & access and use a Full access code.')
  const issuedAt = now()
  return { accessToken: token.access_token, expiresAt: issuedAt + token.expires_in * 1000, issuedAt, scope: String(token.scope), label: input.label }
}
