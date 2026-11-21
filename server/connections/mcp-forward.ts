/** The services' route (`/engine/connections/<id>/mcp`, private listener only): an engine reaches a service a bot added
 *  with its bot's own key, and LilBot forwards Streamable HTTP MCP with the service's token, which never leaves this
 *  process. A 401 is never passed on (an engine would start its own sign-in): LilBot refreshes once, else the connection
 *  is `sign_in_expired` and the route answers with its status tool. Time and size are bounded; a service that does not
 *  answer is `unreachable` and holds up nothing else. State changes reach engines through the watcher, after the answer. */
import { connectionCaller } from './connection-keys'
import { toolNames } from './mcp-address'
import type { McpConnectionStore, StoredConnection } from './mcp-connection-store'
import type { McpConnections } from './mcp-connections'
import type { McpCredentials } from './mcp-credentials'
import { fencedResult, listedTools, serviceSignedOut } from './mcp-forward-replies'
import { boundedFetch, cappedText, Unreachable } from './mcp-http'
import { type JsonRpc, oneMessage, rpcError, rpcResult, toolError } from './mcp-json-rpc'
import { SERVICE_PATH, SERVICE_TIMEOUT_SECONDS, STATUS_TOOL, serviceKeyPurpose } from './mcp-service-connection'
import type { TokenKeeper } from './mcp-token-keeper'

export interface ServiceForwardOptions {
  services: McpConnections
  store: McpConnectionStore
  credentials: McpCredentials
  keeper: TokenKeeper
  engineToken: string
  port: number
  /** Non-deleted LilBot bot ids. */
  botIds: () => string[]
  now?: () => number
}

const FORWARDED_REQUEST = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version']
const FORWARDED_RESPONSE = ['content-type', 'mcp-session-id']
/** Setting up a session answers within this, before the engine's own 30-second connect timeout. */
const SETUP_TIMEOUT_MS = 10_000
const BODY_CAP = 16 << 20
const WORKED_EVERY_MS = 60_000

export function createServiceForward(options: ServiceForwardOptions) {
  const { services, store, credentials, keeper } = options
  const now = options.now ?? Date.now
  const loopback = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])

  const unreachable = (message: JsonRpc, connection: StoredConnection) => {
    store.setState(connection.id, 'unreachable')
    console.warn(`[connections] ${connection.id} did not answer`)
    const text = `${connection.name} is not reachable right now. Try again later; if it keeps failing, tell Oscar.`
    return message.method === 'tools/call' ? toolError(message.id, text) : rpcError(message.id, -32000, text)
  }
  const expired = (message: JsonRpc, connection: StoredConnection) => {
    const credential = credentials.get(connection.id)
    if (credential?.tokens) credentials.set(connection.id, { server: credential.server, client: credential.client })
    store.setState(connection.id, 'sign_in_expired')
    return serviceSignedOut(message, { ...connection, state: 'sign_in_expired' })
  }
  const worked = (connection: StoredConnection) => {
    if (connection.state === 'unreachable') store.setState(connection.id, 'connected')
    if (!connection.lastWorkedAt || now() - connection.lastWorkedAt > WORKED_EVERY_MS) store.worked(connection.id, now())
  }

  const send = async (request: Request, connection: StoredConnection, body: string | undefined, token: string | null, timeoutMs: number) => {
    const headers = new Headers()
    for (const name of FORWARDED_REQUEST) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    if (token) headers.set('authorization', `Bearer ${token}`)
    return boundedFetch(connection.address, { method: request.method, headers, body }, timeoutMs)
  }

  return async (request: Request, path: string): Promise<Response> => {
    if (request.headers.has('origin') || !loopback.has(request.headers.get('host')?.toLowerCase() ?? '')) return Response.json({ error: 'Not allowed.' }, { status: 403 })
    const id = path.match(SERVICE_PATH)?.[1]
    const connection = id ? services.get(id) : null
    const botId = id ? connectionCaller(options.engineToken, serviceKeyPurpose(id), options.botIds(), request.headers.get('authorization') ?? '') : undefined
    if (!connection || !botId) return Response.json({ error: 'Unknown connection or bot credential.' }, { status: 403 })
    // No stream the service opens by itself: every answer comes back on a POST.
    if (request.method !== 'POST' && request.method !== 'DELETE') return new Response(null, { status: 405, headers: { allow: 'POST, DELETE' } })

    const message: JsonRpc | Response = request.method === 'POST' ? await oneMessage(request) : {}
    if (message instanceof Response) return message
    if (!services.usable(connection.id)) return request.method === 'DELETE' ? new Response(null, { status: 204 }) : serviceSignedOut(message, connection)
    if (message.method === 'tools/call') {
      const name = message.params?.name
      if (name === STATUS_TOOL) return rpcResult(message.id, { content: [{ type: 'text', text: `${connection.name} is ${connection.state.replaceAll('_', ' ')}.` }] })
      if (!connection.toolNames.includes(name)) return toolError(message.id, `${String(name)} is not one of ${connection.name}'s tools in LilBot.`)
    }

    const signed = !!credentials.get(connection.id)
    const timeoutMs = message.method === 'tools/call' ? SERVICE_TIMEOUT_SECONDS * 1000 : SETUP_TIMEOUT_MS
    const body = request.method === 'POST' ? JSON.stringify(message) : undefined
    let response: Response
    let text: string
    try {
      let usable = signed ? await keeper.token(connection.id) : null
      if (usable?.kind === 'none') return expired(message, connection)
      if (usable?.kind === 'unreachable') return unreachable(message, connection)
      response = await send(request, connection, body, usable?.kind === 'ok' ? usable.token : null, timeoutMs)
      if (response.status === 401 && usable?.kind === 'ok') {
        await response.body?.cancel()
        usable = await keeper.token(connection.id, usable.token)
        if (usable.kind === 'none') return expired(message, connection)
        if (usable.kind === 'unreachable') return unreachable(message, connection)
        response = await send(request, connection, body, usable.token, timeoutMs)
      }
      if (response.status === 401) {
        await response.body?.cancel()
        if (signed) return expired(message, connection)
        const text = `${connection.name} now asks for a sign-in. Call lilbot_connection with action sign_in and id ${connection.id} for a link, give it to Oscar, and wait.`
        return message.method === 'tools/call' ? toolError(message.id, text) : rpcError(message.id, -32000, text)
      }
      text = await cappedText(response, BODY_CAP)
    } catch (error) {
      if (error instanceof Unreachable) return unreachable(message, connection)
      throw error
    }
    if (response.status >= 500 || (response.status >= 300 && response.status < 400)) return unreachable(message, connection)
    worked(connection)
    const contentType = response.headers.get('content-type') ?? ''
    if (message.method === 'tools/list' && response.ok) {
      const { body: filtered, listed } = listedTools(text, contentType, new Set(connection.toolNames))
      // A service that changed its tools gets them to engines through the watcher. Only a whole list counts: a page does not.
      const names = listed && !message.params?.cursor ? toolNames(listed) : null
      if (names && JSON.stringify(names) !== JSON.stringify(connection.toolNames)) store.setTools(connection.id, names)
      text = filtered
    }
    if (message.method === 'tools/call' && response.ok) text = fencedResult(text, contentType, connection.name)
    const headers = new Headers()
    for (const name of FORWARDED_RESPONSE) {
      const value = response.headers.get(name)
      if (value) headers.set(name, value)
    }
    return new Response(text || null, { status: response.status, headers })
  }
}
