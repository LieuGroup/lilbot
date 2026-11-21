/** A throwaway MCP service on loopback for the connections tests and `check:connections`: one tool, and with `oauth` its own
 *  minimal OAuth server (protected-resource and server metadata, dynamic registration, PKCE S256, the resource indicator,
 *  refresh with rotation). Its sign-in page approves at once: it redirects to the return address with a code, as a
 *  service does after Oscar signs in. It records every token it issued so a check can search for them. */
import { createHash, randomBytes } from 'node:crypto'

export interface ServiceOptions {
  oauth: boolean
  /** The text its tool returns, before the tool's argument. */
  marker: string
  /** How long an access token lasts. */
  accessSeconds?: number
  /** Advertise and send `iss` on the sign-in's return (RFC 9207). */
  iss?: boolean
  port?: number
}

const token = () => randomBytes(24).toString('base64url')
const rpc = (id: unknown, result: unknown, headers: Record<string, string> = {}) => Response.json({ jsonrpc: '2.0', id, result }, { headers })

export function serviceFixture(options: ServiceOptions) {
  const clients = new Map<string, string[]>()
  const codes = new Map<string, { client: string; redirect: string; challenge: string; resource: string }>()
  const access = new Map<string, number>()
  const refresh = new Set<string>()
  const issued: string[] = []
  const counts = { toolCalls: 0, codeGrants: 0, refreshGrants: 0, refusedTokens: 0 }
  const tool = options.oauth ? 'secret_word' : 'echo'
  let base = ''
  const resource = () => `${base}/mcp`

  const grant = () => {
    const accessToken = token()
    const refreshToken = token()
    access.set(accessToken, Date.now() + (options.accessSeconds ?? 3600) * 1000)
    refresh.add(refreshToken)
    issued.push(accessToken, refreshToken)
    return Response.json({ access_token: accessToken, token_type: 'Bearer', expires_in: options.accessSeconds ?? 3600, refresh_token: refreshToken })
  }

  async function tokenEndpoint(request: Request) {
    const form = new URLSearchParams(await request.text())
    if (form.get('resource') !== resource() || !clients.has(form.get('client_id') ?? '')) return Response.json({ error: 'invalid_request' }, { status: 400 })
    if (form.get('grant_type') === 'authorization_code') {
      const code = codes.get(form.get('code') ?? '')
      codes.delete(form.get('code') ?? '')
      const verified =
        code &&
        createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url') === code.challenge
      if (!verified || code.client !== form.get('client_id') || code.redirect !== form.get('redirect_uri')) return Response.json({ error: 'invalid_grant' }, { status: 400 })
      counts.codeGrants++
      return grant()
    }
    const old = form.get('refresh_token') ?? ''
    if (form.get('grant_type') !== 'refresh_token' || !refresh.delete(old)) return Response.json({ error: 'invalid_grant' }, { status: 400 })
    counts.refreshGrants++
    return grant()
  }

  function authorize(url: URL) {
    const client = url.searchParams.get('client_id') ?? ''
    const redirect = url.searchParams.get('redirect_uri') ?? ''
    const ok =
      clients.get(client)?.includes(redirect) &&
      url.searchParams.get('response_type') === 'code' &&
      url.searchParams.get('code_challenge_method') === 'S256' &&
      url.searchParams.get('resource') === resource()
    if (!ok) return new Response('Bad sign-in request', { status: 400 })
    const code = token()
    codes.set(code, { client, redirect, challenge: url.searchParams.get('code_challenge') ?? '', resource: resource() })
    const back = new URL(redirect)
    back.searchParams.set('code', code)
    back.searchParams.set('state', url.searchParams.get('state') ?? '')
    if (options.iss) back.searchParams.set('iss', base)
    return new Response(null, { status: 302, headers: { location: back.href } })
  }

  async function mcp(request: Request) {
    if (options.oauth) {
      const given = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? ''
      if (!((access.get(given) ?? 0) > Date.now())) {
        if (given) counts.refusedTokens++
        return new Response('Unauthorized', {
          status: 401,
          headers: { 'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="tools"` }
        })
      }
    }
    if (request.method === 'DELETE') return new Response(null, { status: 204 })
    const message = await request.json()
    if (message.id === undefined) return new Response(null, { status: 202 })
    if (message.method === 'initialize')
      return rpc(message.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }, { 'mcp-session-id': 'fixture-session' })
    if (message.method === 'tools/list')
      return rpc(message.id, {
        tools: [{ name: tool, description: `Returns ${options.marker} and the text given.`, inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }]
      })
    if (message.method === 'tools/call') {
      counts.toolCalls++
      return rpc(message.id, { content: [{ type: 'text', text: `${options.marker}${message.params?.arguments?.text ?? ''}` }] })
    }
    return Response.json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown' } })
  }

  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: options.port ?? 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname === '/mcp') return mcp(request)
      if (!options.oauth) return new Response('Not found', { status: 404 })
      if (url.pathname === '/.well-known/oauth-protected-resource/mcp') return Response.json({ resource: resource(), authorization_servers: [base], scopes_supported: ['tools'] })
      if (url.pathname === '/.well-known/oauth-authorization-server')
        return Response.json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          registration_endpoint: `${base}/register`,
          code_challenge_methods_supported: ['S256'],
          authorization_response_iss_parameter_supported: options.iss === true
        })
      if (url.pathname === '/register' && request.method === 'POST') {
        const body = await request.json()
        const id = `client-${token()}`
        clients.set(id, body.redirect_uris)
        return Response.json({ client_id: id, token_endpoint_auth_method: 'none' }, { status: 201 })
      }
      if (url.pathname === '/authorize') return authorize(url)
      if (url.pathname === '/token' && request.method === 'POST') return tokenEndpoint(request)
      return new Response('Not found', { status: 404 })
    }
  })
  base = `http://127.0.0.1:${server.port}`
  return {
    server,
    address: `${base}/mcp`,
    issued,
    counts,
    tool,
    /** Every token stops working, refresh tokens included: the next call needs a new sign-in. */
    revoke() {
      access.clear()
      refresh.clear()
    },
    /** Access tokens stop working; refresh tokens still do. */
    expireAccess() {
      for (const key of access.keys()) access.set(key, 0)
    },
    stop: () => server.stop(true)
  }
}
