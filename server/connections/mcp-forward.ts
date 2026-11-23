/** The services' route (`/engine/connections/<id>/mcp`, private listener only): an engine reaches a service a bot added
 *  with its bot's own key, and LilBot forwards Streamable HTTP MCP with the service's token, which never leaves this
 *  process. A 401 is never passed on (an engine would start its own sign-in): LilBot refreshes once, else the connection
 *  is `sign_in_expired` and the route answers with its status tool. Time and size are bounded; answers are rebuilt cleanly;
 *  a service that does not answer is `unreachable` and holds up nothing else. */
import { connectionCaller } from './connection-keys'
import { ENGINE_PREFIX, isLoopback, toolNames } from './mcp-address'
import type { McpConnectionStore, StoredConnection } from './mcp-connection-store'
import type { McpConnections } from './mcp-connections'
import type { McpCredentials } from './mcp-credentials'
import { rebuildResponse, serviceGenericError, serviceSignedOut } from './mcp-forward-replies'
import { boundedFetch, cappedText, Unreachable } from './mcp-http'
import { type JsonRpc, oneMessage, refusedResult, rpcError, rpcResult, toolError } from './mcp-json-rpc'
import { SERVICE_PATH, SERVICE_TIMEOUT_SECONDS, STATUS_TOOL, serviceKeyPurpose } from './mcp-service-connection'
import type { TokenKeeper } from './mcp-token-keeper'

interface ServiceForwardOptions {
  services: McpConnections
  store: McpConnectionStore
  credentials: McpCredentials
  keeper: TokenKeeper
  engineToken: string
  port: number
  /** Non-deleted LilBot bot ids. */
  botIds: () => string[]
  /** Defence-in-depth session gate (webhook runs, check sessions), or null when allowed. */
  refusal?: (botId: string, tool: string, args: unknown) => Promise<string | null>
  /** Maps an MCP server and raw tool name to the name the calling bot's engine reports in tool-call events. */
  toolName?: (server: string, tool: string, botId?: string) => string
  now?: () => number
}

const FORWARDED_REQUEST = ['accept', 'content-type', 'mcp-session-id', 'mcp-protocol-version']
/** Setting up a session answers within this, before the engine's own 30-second connect timeout. */
const SETUP_TIMEOUT_MS = 10_000
const BODY_CAP = 16 << 20
const WORKED_EVERY_MS = 60_000
const TOOLS_UPDATE_MIN_MS = 60_000
const defaultToolName = (server: string, tool: string) => `mcp__${server}__${tool}`

export function createServiceForward(options: ServiceForwardOptions) {
  const { services, store, credentials, keeper } = options
  const now = options.now ?? Date.now
  const engineToolName = options.toolName ?? defaultToolName
  const loopback = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])
  const toolsUpdatedAt = new Map<string, number>()

  const unreachable = (message: JsonRpc, connection: StoredConnection) => {
    store.setState(connection.id, 'unreachable')
    console.warn(`[connections] ${connection.id} did not answer`)
    const text = `${connection.name} is not reachable right now. Try again later; if it keeps failing, tell Oscar.`
    return message.method === 'tools/call' ? toolError(message.id, text) : rpcError(message.id, -32000, text)
  }
  const expired = (message: JsonRpc, connection: StoredConnection, refusedToken?: string) => {
    const credential = credentials.get(connection.id)
    // Never wipe tokens from a concurrent fresh sign-in that landed while this call was in flight.
    if (credential?.tokens && refusedToken !== undefined && credential.tokens.accessToken === refusedToken) {
      credentials.set(connection.id, { server: credential.server, client: credential.client })
    }
    const current = credentials.get(connection.id)
    if (!current?.tokens) store.setState(connection.id, 'sign_in_expired')
    return serviceSignedOut(message, { ...connection, state: current?.tokens ? connection.state : 'sign_in_expired' })
  }
  const worked = (connection: StoredConnection) => {
    if (connection.state === 'unreachable' || (connection.state === 'needs_sign_in' && !credentials.get(connection.id))) store.setState(connection.id, 'connected')
    if (!connection.lastWorkedAt || now() - connection.lastWorkedAt > WORKED_EVERY_MS) store.worked(connection.id, now())
  }

  const send = async (request: Request, connection: StoredConnection, body: string | undefined, token: string | null, timeoutMs: number) => {
    const headers = new Headers()
    for (const name of FORWARDED_REQUEST) {
      const value = request.headers.get(name)
      if (value) headers.set(name, value)
    }
    if (token) headers.set('authorization', `Bearer ${token}`)
    const target = new URL(connection.address)
    return boundedFetch(target, { method: request.method, headers, body }, timeoutMs, isLoopback(target))
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
      const refused = await options.refusal?.(botId, engineToolName(`${ENGINE_PREFIX}${connection.name}`, name, botId), message.params?.arguments)
      if (refused) return refusedResult(message.id, refused)
    }

    const signed = !!credentials.get(connection.id)
    const timeoutMs = message.method === 'tools/call' ? SERVICE_TIMEOUT_SECONDS * 1000 : SETUP_TIMEOUT_MS
    const body = request.method === 'POST' ? JSON.stringify(message) : undefined
    let response: Response
    let text: string
    try {
      const tokenBefore = signed ? credentials.get(connection.id)?.tokens?.accessToken : undefined
      let usable = signed ? await keeper.token(connection.id) : null
      if (usable?.kind === 'none') return expired(message, connection, tokenBefore)
      if (usable?.kind === 'unreachable') return unreachable(message, connection)
      let sentToken = usable?.kind === 'ok' ? usable.token : undefined
      response = await send(request, connection, body, sentToken ?? null, timeoutMs)
      if (response.status === 401 && sentToken !== undefined) {
        await response.body?.cancel()
        usable = await keeper.token(connection.id, sentToken)
        if (usable.kind === 'none') return expired(message, connection, sentToken)
        if (usable.kind === 'unreachable') return unreachable(message, connection)
        sentToken = usable.token
        response = await send(request, connection, body, sentToken, timeoutMs)
      }
      if (response.status === 401) {
        await response.body?.cancel()
        if (signed) return expired(message, connection, sentToken)
        store.setState(connection.id, 'needs_sign_in')
        const prompt = `${connection.name} now asks for a sign-in. Call lilbot_connection with action sign_in and id ${connection.id}; LilBot places a sign-in card for Oscar and tells you when he finishes.`
        return message.method === 'tools/call' ? toolError(message.id, prompt) : rpcError(message.id, -32000, prompt)
      }
      if (response.status >= 500 || (response.status >= 300 && response.status < 400)) {
        await response.body?.cancel()
        return unreachable(message, connection)
      }
      if (!response.ok) {
        await response.body?.cancel()
        return request.method === 'DELETE' ? new Response(null, { status: 204 }) : serviceGenericError(message, connection.name)
      }
      text = await cappedText(response, BODY_CAP)
    } catch (error) {
      if (error instanceof Unreachable) return unreachable(message, connection)
      throw error
    }
    worked(connection)
    const headers = new Headers()
    const session = response.headers.get('mcp-session-id')
    if (session) headers.set('mcp-session-id', session)
    if (!text) {
      if (response.status === 202 || response.status === 204 || request.method === 'DELETE') return new Response(null, { status: response.status, headers })
      return serviceGenericError(message, connection.name)
    }
    const rebuilt = rebuildResponse(text, response.headers.get('content-type') ?? '', message, connection, new Set(connection.toolNames))
    if ('error' in rebuilt) return rebuilt.error
    if (message.method === 'tools/list' && rebuilt.listed && !message.params?.cursor) {
      const names = toolNames(rebuilt.listed, tool => engineToolName(`${ENGINE_PREFIX}${connection.name}`, tool, botId))
      const last = toolsUpdatedAt.get(connection.id)
      if (JSON.stringify(names) !== JSON.stringify(connection.toolNames) && (last === undefined || now() - last >= TOOLS_UPDATE_MIN_MS)) {
        toolsUpdatedAt.set(connection.id, now())
        store.setTools(connection.id, names)
      }
    }
    headers.set('content-type', rebuilt.contentType)
    return new Response(rebuilt.body, { status: response.status, headers })
  }
}
