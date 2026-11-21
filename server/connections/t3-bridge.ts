/** LilBot's T3 Code bridge: a loopback MCP endpoint every engine connects to with its bot's own key.
 *  It forwards Streamable HTTP MCP to T3 Code with LilBot's one sign-in, which never leaves this
 *  process. T3 Code still owns projects, threads, worktrees and pull requests. */

import { connectionCaller } from './connection-keys'
import { listedTools } from './mcp-forward-replies'
import { oneMessage, refusedResult, rpcError, rpcResult, toolError } from './mcp-json-rpc'
import { scopedRequestId, t3SignedOut } from './t3-bridge-replies'
import { T3_KEY_PURPOSE, T3_STATUS_TOOL, T3_TOOLS } from './t3-connection'
import { signInMessage, type T3Grants } from './t3-grant'

export interface T3BridgeOptions {
  /** T3 Code's MCP URL, normally `http://127.0.0.1:3773/mcp`. */
  upstream: string
  grants: T3Grants
  engineToken: string
  port: number
  /** Non-deleted LilBot bot ids. */
  botIds: () => string[]
  /** Why the calling session may not make this call (a webhook run without coding), or null. */
  refusal: (botId: string, tool: string, args: unknown) => Promise<string | null>
  fetch?: typeof fetch
}

const FORWARDED_REQUEST = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version', 'last-event-id']
const FORWARDED_RESPONSE = ['content-type', 'mcp-session-id', 'cache-control']
const ALLOWED = new Set<string>(T3_TOOLS)

export function createT3Bridge(options: T3BridgeOptions) {
  const fetcher = options.fetch ?? fetch
  const loopback = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])
  const explanation = () => signInMessage(options.grants.status())

  const upstream = async (request: Request, token: string, body?: string): Promise<Response | null> => {
    const headers = new Headers({ authorization: `Bearer ${token}` })
    for (const name of FORWARDED_REQUEST) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    try {
      return await fetcher(options.upstream, { method: request.method, headers, body, redirect: 'manual', signal: request.signal })
    } catch {
      return null
    }
  }
  const passThrough = (response: Response, body?: BodyInit | null) => {
    const headers = new Headers()
    for (const name of FORWARDED_RESPONSE) {
      const value = response.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(body === undefined ? response.body : body, { status: response.status, headers })
  }

  return async (request: Request): Promise<Response> => {
    // Only engine processes on this machine: loopback Host, never a browser, and a bot's own key.
    if (request.headers.has('origin') || !loopback.has(request.headers.get('host')?.toLowerCase() ?? '')) return Response.json({ error: 'Not allowed.' }, { status: 403 })
    const botId = connectionCaller(options.engineToken, T3_KEY_PURPOSE, options.botIds(), request.headers.get('authorization') ?? '')
    if (!botId) return Response.json({ error: 'Unknown bot credential.' }, { status: 403 })

    if (request.method !== 'POST') {
      const grant = options.grants.usable()
      if (!grant) return new Response(null, { status: request.method === 'DELETE' ? 204 : 405, headers: { allow: 'POST' } })
      const response = await upstream(request, grant.accessToken)
      return response ? passThrough(response) : new Response(null, { status: 502 })
    }

    const message = await oneMessage(request)
    if (message instanceof Response) return message

    if (message.method === 'tools/call') {
      const name = message.params?.name
      const signedIn = options.grants.usable()
      if (name === T3_STATUS_TOOL && signedIn)
        return rpcResult(message.id, {
          content: [
            { type: 'text', text: `LilBot is signed in to T3 Code until ${new Date(signedIn.expiresAt).toISOString().slice(0, 10)}. Start a new session so the T3 tools load.` }
          ]
        })
      if (!ALLOWED.has(name)) return signedIn ? toolError(message.id, `${String(name)} is not available to LilBot bots.`) : t3SignedOut(message, explanation())
      const refused = await options.refusal(botId, name, message.params.arguments)
      if (refused) return refusedResult(message.id, refused)
      const args = message.params.arguments
      if (args && typeof args.clientRequestId === 'string') args.clientRequestId = scopedRequestId(botId, args.clientRequestId)
    }

    const grant = options.grants.usable()
    if (!grant) return t3SignedOut(message, explanation())
    const response = await upstream(request, grant.accessToken, JSON.stringify(message))
    if (!response) {
      const text = 'T3 Code is not reachable on this machine right now. Tell Oscar; do not start the task another way.'
      return message.method === 'tools/call' ? toolError(message.id, text) : rpcError(message.id, -32000, text)
    }
    // Never pass T3's 401 on: an engine would start its own OAuth sign-in for the bridge.
    if (response.status === 401) {
      await response.body?.cancel()
      // One refusal could be a passing fault in T3; a second, on a plain ping, means the grant is gone.
      const probe = await upstream(
        new Request(options.upstream, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }),
        grant.accessToken,
        JSON.stringify({ jsonrpc: '2.0', id: 'lilbot-probe', method: 'ping' })
      )
      await probe?.body?.cancel()
      if (probe?.status !== 401)
        return message.method === 'tools/call'
          ? toolError(message.id, 'T3 Code refused this call once. Try again.')
          : rpcError(message.id, -32000, 'T3 Code refused this call once. Try again.')
      options.grants.markRevoked()
      console.error('[t3-bridge] T3 Code refused LilBot’s sign-in; it needs a new approval.')
      return t3SignedOut(message, explanation())
    }
    if (message.method === 'tools/list' && response.ok) {
      const contentType = response.headers.get('content-type') ?? ''
      return passThrough(response, listedTools(await response.text(), contentType, ALLOWED).body)
    }
    return passThrough(response)
  }
}
