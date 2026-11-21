/** Finds how a service wants LilBot to sign in, the MCP way: its protected-resource metadata (RFC 9728, from the 401's
 *  `WWW-Authenticate` or the well-known path), then its authorisation server's metadata (RFC 8414, OpenID as fallback),
 *  then a client registration (RFC 7591). Every address it is given is checked like the service's own. */
import { LilBotError } from '../../shared/lilbot-error'
import { endpointOf } from './mcp-address'
import { boundedFetch, jsonBody } from './mcp-http'

export interface AuthServer {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint?: string
  /** The resource indicator (RFC 8707) tokens are asked for. */
  resource: string
  scope?: string
  /** The server says it adds `iss` to its answers (RFC 9207): one without it is refused. */
  issRequired: boolean
}

export interface OAuthClient {
  clientId: string
  /** Kept only in the credential file. */
  clientSecret?: string
  authMethod: 'none' | 'client_secret_post' | 'client_secret_basic'
}

const refuse = (text: string) => new LilBotError('connection_sign_in', text)
const param = (header: string, name: string) => header.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1]
/** The service address as a resource: no query, no trailing slash. */
const canonical = (url: URL) => `${url.origin}${url.pathname.replace(/\/+$/, '')}`

async function firstJson(urls: string[]) {
  for (const url of urls) {
    const response = await boundedFetch(url, { headers: { accept: 'application/json' } }).catch(() => null)
    if (!response?.ok) {
      await response?.body?.cancel()
      continue
    }
    const json = await jsonBody(response)
    if (json) return json
  }
  return null
}

const wellKnown = (base: URL, name: string) => {
  const path = base.pathname.replace(/\/+$/, '')
  return [...(path ? [`${base.origin}/.well-known/${name}${path}`] : []), `${base.origin}/.well-known/${name}`]
}

export async function discover(service: URL, challenge: string): Promise<AuthServer> {
  const pointed = param(challenge, 'resource_metadata')
  const resourceMeta = await firstJson(pointed ? [endpointOf(pointed, service).href] : wellKnown(service, 'oauth-protected-resource'))
  let resource = canonical(service)
  if (resourceMeta) {
    const named = endpointOf(resourceMeta.resource, service)
    const prefix = canonical(named)
    if (named.origin !== service.origin || !(resource === prefix || resource.startsWith(`${prefix}/`))) throw refuse('The service describes itself as another address.')
    resource = prefix
  }
  const servers = resourceMeta?.authorization_servers
  const issuer = endpointOf(Array.isArray(servers) ? servers[0] : service.origin, service)
  const issuerPath = issuer.pathname.replace(/\/+$/, '')
  const meta = await firstJson([
    ...wellKnown(issuer, 'oauth-authorization-server'),
    ...wellKnown(issuer, 'openid-configuration'),
    ...(issuerPath ? [`${issuer.origin}${issuerPath}/.well-known/openid-configuration`] : [])
  ])
  if (!meta) throw refuse('The service asks for a sign-in but LilBot found no way to sign in to it.')
  if (typeof meta.issuer !== 'string' || canonical(endpointOf(meta.issuer, service)) !== canonical(issuer)) throw refuse('The sign-in server describes itself as another one.')
  if (!Array.isArray(meta.code_challenge_methods_supported) || !meta.code_challenge_methods_supported.includes('S256'))
    throw refuse('The service’s sign-in does not offer the protection LilBot requires (PKCE with S256).')
  const scopes =
    param(challenge, 'scope') ?? (Array.isArray(resourceMeta?.scopes_supported) ? resourceMeta.scopes_supported.filter((s: unknown) => typeof s === 'string').join(' ') : '')
  return {
    issuer: meta.issuer,
    authorizationEndpoint: endpointOf(meta.authorization_endpoint, service).href,
    tokenEndpoint: endpointOf(meta.token_endpoint, service).href,
    ...(meta.registration_endpoint ? { registrationEndpoint: endpointOf(meta.registration_endpoint, service).href } : {}),
    resource,
    ...(scopes ? { scope: scopes } : {}),
    issRequired: meta.authorization_response_iss_parameter_supported === true
  }
}

/** Registers LilBot as a public client with the one redirect address it uses. */
export async function register(server: AuthServer, redirectUri: string): Promise<OAuthClient> {
  if (!server.registrationEndpoint) throw refuse('The service does not let LilBot register for a sign-in (no dynamic client registration); LilBot cannot sign in to it yet.')
  const response = await boundedFetch(server.registrationEndpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'LilBot',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none'
    })
  })
  if (!response.ok) await response.body?.cancel()
  const json = response.ok ? await jsonBody(response) : null
  if (typeof json?.client_id !== 'string' || !json.client_id) throw refuse('The service refused LilBot’s registration for a sign-in.')
  const method = json.token_endpoint_auth_method
  const authMethod = method === 'client_secret_post' || method === 'client_secret_basic' ? method : 'none'
  return { clientId: json.client_id, ...(typeof json.client_secret === 'string' && json.client_secret ? { clientSecret: json.client_secret } : {}), authMethod }
}
