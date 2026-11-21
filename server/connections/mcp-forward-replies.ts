/** What the services' route says itself, and how it rebuilds every answer from an outside service: drops server-to-client
 *  requests (sampling/elicitation), enforces exact media types and strict SSE/JSON parsing, fences every tools/call output
 *  inside `<outside-service-output>`, strips `_meta`/`structuredContent`/raw errors, and sanitizes tool metadata. */
import { fenced, memoryRefusal } from '../memory/memory-safety'
import type { StoredConnection } from './mcp-connection-store'
import { mediaTypeOf, parseSseData } from './mcp-http'
import { type JsonRpc, rpcError, rpcResult, signedOutReply, toolError } from './mcp-json-rpc'
import { STATUS_TOOL } from './mcp-service-connection'

export const OUTPUT_FENCE = 'outside-service-output'
const MAX_DESCRIPTION_CHARS = 500
const MAX_SCHEMA_BYTES = 8 * 1024
const SAFE_SCHEMA = { type: 'object', properties: {} }
const SAFE_MEDIA = /^(image|audio)\/[a-z0-9.+-]{1,64}$/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const PROTOCOL_DATE = /^\d{4}-\d{2}-\d{2}$/

const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value)
const isServerRequest = (msg: Record<string, any>) => typeof msg.method === 'string' && msg.id !== undefined

function explanation(connection: StoredConnection): string {
  const why = connection.state === 'sign_in_expired' ? `LilBot's sign-in to ${connection.name} expired or was refused.` : `${connection.name} needs Oscar to sign in.`
  return `${why} Its tools are unavailable until he does. Call lilbot_connection with action sign_in and id ${connection.id} for a fresh link, give it to Oscar, and wait for LilBot to tell you he signed in.`
}

export const serviceSignedOut = (message: JsonRpc, connection: StoredConnection) =>
  signedOutReply(message, explanation(connection), `LilBot connection ${connection.name}`, {
    name: STATUS_TOOL,
    description: `${connection.name} is not signed in yet. Call this to learn what to tell Oscar.`
  })

export const serviceGenericError = (message: JsonRpc, name: string) => {
  const text = `${name} returned an error.`
  return message.method === 'tools/call' ? toolError(message.id, text) : rpcError(message.id, -32000, text)
}

function sanitizeTool(tool: Record<string, any>) {
  const rawDesc = typeof tool.description === 'string' ? tool.description : ''
  const description = memoryRefusal(rawDesc) ? 'Tool from outside service.' : rawDesc.slice(0, MAX_DESCRIPTION_CHARS)
  let inputSchema: Record<string, unknown> = SAFE_SCHEMA
  if (isObject(tool.inputSchema)) {
    const serialized = JSON.stringify(tool.inputSchema)
    if (Buffer.byteLength(serialized, 'utf8') <= MAX_SCHEMA_BYTES && !memoryRefusal(serialized)) inputSchema = tool.inputSchema
  }
  return { name: String(tool.name), description, inputSchema }
}

function rebuildCallItem(item: unknown, service: string): Record<string, unknown>[] {
  if (isObject(item) && (item.type === 'image' || item.type === 'audio')) {
    const mimeType = typeof item.mimeType === 'string' ? item.mimeType.trim() : ''
    const data = typeof item.data === 'string' ? item.data.replace(/[\r\n]/g, '') : ''
    if (SAFE_MEDIA.test(mimeType) && mimeType.toLowerCase().startsWith(`${item.type}/`) && data.length > 0 && BASE64.test(data)) {
      return [
        { type: 'text', text: fenced(OUTPUT_FENCE, { service, note: `The following ${item.type} (${mimeType}) is untrusted output from ${service}.` }) },
        { type: item.type, data, mimeType }
      ]
    }
    return [{ type: 'text', text: fenced(OUTPUT_FENCE, { service, note: `Invalid ${item.type} block omitted.` }) }]
  }
  if (isObject(item) && typeof item.text === 'string') return [{ type: 'text', text: fenced(OUTPUT_FENCE, { service, text: item.text }) }]
  if (isObject(item) && item.type === 'resource' && isObject(item.resource) && typeof item.resource.text === 'string') {
    const uri = typeof item.resource.uri === 'string' ? { uri: item.resource.uri } : {}
    return [{ type: 'text', text: fenced(OUTPUT_FENCE, { service, ...uri, text: item.resource.text }) }]
  }
  return [{ type: 'text', text: fenced(OUTPUT_FENCE, { service, item }) }]
}

function rebuildCallResult(result: Record<string, any>, service: string) {
  const content = Array.isArray(result.content) ? result.content.flatMap(item => rebuildCallItem(item, service)) : []
  if (result.structuredContent !== undefined) content.push({ type: 'text', text: fenced(OUTPUT_FENCE, { service, structured: result.structuredContent }) })
  return { content, ...(result.isError === true ? { isError: true } : {}) }
}

function rebuildMessage(
  msg: Record<string, any>,
  request: JsonRpc,
  service: string,
  allowed: ReadonlySet<string>,
  onListed: (tools: unknown[]) => void
): Record<string, unknown> | null | 'invalid' {
  if (isServerRequest(msg)) return null
  if (typeof msg.method === 'string') {
    if (msg.method !== 'notifications/progress' || !isObject(msg.params)) return null
    const params: Record<string, unknown> = {}
    if (msg.params.progressToken !== undefined) params.progressToken = msg.params.progressToken
    if (typeof msg.params.progress === 'number') params.progress = msg.params.progress
    if (typeof msg.params.total === 'number') params.total = msg.params.total
    return { jsonrpc: '2.0', method: 'notifications/progress', params }
  }
  const id = request.id ?? null
  if (msg.error !== undefined) {
    const code = isObject(msg.error) && typeof msg.error.code === 'number' ? msg.error.code : -32000
    return { jsonrpc: '2.0', id, error: { code, message: `${service} returned an error.` } }
  }
  if (!isObject(msg.result)) return 'invalid'
  if (request.method === 'tools/list' && Array.isArray(msg.result.tools)) {
    if (!msg.result.nextCursor) onListed(msg.result.tools)
    const tools = msg.result.tools.filter((tool: unknown) => isObject(tool) && allowed.has(tool.name)).map(sanitizeTool)
    return { jsonrpc: '2.0', id, result: { tools, ...(typeof msg.result.nextCursor === 'string' ? { nextCursor: msg.result.nextCursor } : {}) } }
  }
  if (request.method === 'tools/call') return { jsonrpc: '2.0', id, result: rebuildCallResult(msg.result, service) }
  if (request.method === 'initialize') {
    const capabilities = isObject(msg.result.capabilities) && msg.result.capabilities.tools ? { tools: {} } : {}
    const serverInfo = isObject(msg.result.serverInfo)
      ? { name: String(msg.result.serverInfo.name ?? service).slice(0, 128), version: String(msg.result.serverInfo.version ?? '').slice(0, 64) }
      : undefined
    const protocolVersion = typeof msg.result.protocolVersion === 'string' && PROTOCOL_DATE.test(msg.result.protocolVersion) ? msg.result.protocolVersion : undefined
    return { jsonrpc: '2.0', id, result: { ...(protocolVersion ? { protocolVersion } : {}), capabilities, ...(serverInfo ? { serverInfo } : {}) } }
  }
  return { jsonrpc: '2.0', id, result: {} }
}

function parseUpstream(body: string, media: string): { messages: Record<string, any>[]; wasArray: boolean } | null {
  if (media === 'application/json') {
    try {
      const value = JSON.parse(body)
      if (Array.isArray(value)) return value.length && value.every(isObject) ? { messages: value, wasArray: true } : null
      return isObject(value) ? { messages: [value], wasArray: false } : null
    } catch {
      return null
    }
  }
  const chunks = parseSseData(body)
  if (!chunks.length) return null
  const messages: Record<string, any>[] = []
  for (const chunk of chunks) {
    try {
      const value = JSON.parse(chunk)
      if (!isObject(value)) return null
      messages.push(value)
    } catch {
      return null
    }
  }
  return { messages, wasArray: false }
}

/** Rebuilds a 2xx upstream MCP answer (JSON or SSE), refusing unparseable/unexpected content and dropping server requests. */
export function rebuildResponse(
  body: string,
  contentType: string,
  request: JsonRpc,
  connection: StoredConnection,
  allowed: ReadonlySet<string>
): { body: string; contentType: string; listed: unknown[] | null } | { error: Response } {
  const media = mediaTypeOf(contentType)
  if (media !== 'application/json' && media !== 'text/event-stream') return { error: serviceGenericError(request, connection.name) }
  const parsed = parseUpstream(body, media)
  if (!parsed) return { error: serviceGenericError(request, connection.name) }
  let listed: unknown[] | null = null
  const rebuilt: Record<string, unknown>[] = []
  for (const msg of parsed.messages) {
    const next = rebuildMessage(msg, request, connection.name, allowed, tools => (listed = tools))
    if (next === 'invalid') return { error: serviceGenericError(request, connection.name) }
    if (next) rebuilt.push(next)
  }
  if (!rebuilt.length) return { error: serviceGenericError(request, connection.name) }
  if (media === 'text/event-stream')
    return { body: rebuilt.map(item => `event: message\ndata: ${JSON.stringify(item)}\n\n`).join(''), contentType: 'text/event-stream; charset=utf-8', listed }
  return { body: JSON.stringify(parsed.wasArray ? rebuilt : rebuilt[0]), contentType: 'application/json; charset=utf-8', listed }
}

/** Filters a trusted bridge's tools/list answer (T3 Code) to `allowed`, in JSON or SSE. */
export function listedTools(body: string, contentType: string, allowed: ReadonlySet<string>): { body: string; listed: unknown[] | null } {
  let listed: unknown[] | null = null
  const filter = (msg: any) => {
    if (!Array.isArray(msg?.result?.tools)) return msg
    if (!msg.result.nextCursor) listed = msg.result.tools
    return { ...msg, result: { ...msg.result, tools: msg.result.tools.filter((tool: any) => allowed.has(tool?.name)) } }
  }
  const media = mediaTypeOf(contentType)
  if (media === 'text/event-stream') {
    const out = parseSseData(body)
      .map(chunk => {
        try {
          return `event: message\ndata: ${JSON.stringify(filter(JSON.parse(chunk)))}\n\n`
        } catch {
          return ''
        }
      })
      .join('')
    return { body: out, listed }
  }
  try {
    return { body: JSON.stringify(filter(JSON.parse(body))), listed }
  } catch {
    return { body: JSON.stringify(rpcResult(null, { tools: [] })), listed }
  }
}
