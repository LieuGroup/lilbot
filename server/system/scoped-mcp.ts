/** Session-bound Streamable HTTP MCP endpoints for limited sessions:
 *  - `POST /engine/lilbot/session/<grantId>/mcp` (scoped LilBot tools)
 *  - `POST /engine/lilbot/session/<grantId>/t3/mcp` (optional T3 Code bridge when `'coding'` is granted)
 *
 *  Every call is authenticated by its per-session HMAC key, verified against the persisted `session_grants` row
 *  (active, unrevoked, unexpired, live bot), and executed with the grant's authoritative session context — never
 *  consulting `CallingChats`. Long-running T3 waits are clamped below Hermes's 30 s editor MCP timeout. */
import { ZodError } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { type JsonRpc, oneMessage, refusedResult, rpcError, rpcResult, toolError } from '../connections/mcp-json-rpc'
import type { ReviewOutcomeTracker } from '../memory/review-run'
import { inputSchema, type McpCallContext, type McpTool } from './mcp-tool'
import { SESSION_MCP_PREFIX, SESSION_SYSTEM_NAME, SESSION_T3_NAME, type SessionGrant, type SessionGrants } from './session-grants'
import { scopedCallRefusal, scopedToolsFor, scopeInstructions } from './session-scope'
import type { SystemChanges } from './system-changes'

interface ScopedMcpOptions {
  port: number
  grants: SessionGrants
  bots: () => { id: string; name: string }[]
  tools: McpTool[]
  changes: SystemChanges
  beyondOwn: (botId: string, tool: string, args: unknown) => boolean
  t3Enabled?: boolean
  t3Forward?: (botId: string, request: Request) => Promise<Response>
  reviewTracker?: ReviewOutcomeTracker
}

const SERVER_INFO = { name: 'LilBot', version: '1.0.0' }
const SYSTEM_ROUTE = new RegExp(`^${SESSION_MCP_PREFIX}([0-9a-f-]{8,64})/mcp$`)
const T3_ROUTE = new RegExp(`^${SESSION_MCP_PREFIX}([0-9a-f-]{8,64})/t3/mcp$`)
/** Keeps `t3_thread_wait` safely below Hermes's hardcoded 30 s `editor.mcp_servers` tool timeout. */
export const SCOPED_T3_WAIT_CAP_MS = 20_000
const SCOPED_T3_FETCH_TIMEOUT_MS = 25_000

const formatError = (error: unknown) => {
  if (error instanceof LilBotError) return error.message
  if (error instanceof ZodError) return `Invalid arguments: ${error.issues[0]?.path.join('.') || 'input'} ${error.issues[0]?.message ?? ''}`.trim()
  return undefined
}

const callContext = (grant: SessionGrant, chatId: string): McpCallContext => ({
  chatId,
  sessionBound: true,
  ...(grant.scope.kind === 'check' ? { checkId: grant.scope.checkId } : {}),
  ...(grant.scope.kind === 'webhook' ? { capabilities: grant.scope.capabilities, webhookRunId: grant.scope.runId } : {}),
  ...(grant.scope.kind === 'narrowed' ? { capabilities: grant.scope.capabilities } : {}),
  ...(grant.scope.kind === 'review' ? { review: true } : {})
})

/** Rewrites `t3_thread_wait` calls to cap `timeoutMs` under Hermes's 30 s editor MCP tool timeout. */
function clampT3WaitBody(parsed: Record<string, unknown>): string | null {
  if (parsed.method !== 'tools/call') return null
  const params = parsed.params as Record<string, unknown> | undefined
  if (params?.name !== 't3_thread_wait') return null
  const args = (params.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments) ? params.arguments : {}) as Record<string, unknown>
  const requested = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs) ? args.timeoutMs : SCOPED_T3_WAIT_CAP_MS
  const clamped = Math.max(1000, Math.min(requested, SCOPED_T3_WAIT_CAP_MS))
  return JSON.stringify({ ...parsed, params: { ...params, arguments: { ...args, timeoutMs: clamped } } })
}

export function createScopedMcp(options: ScopedMcpOptions) {
  const loopback = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])
  const allTools = new Map(options.tools.map(tool => [tool.name, tool]))
  const t3Enabled = Boolean(options.t3Enabled)

  const checkLoopback = (request: Request) => !request.headers.has('origin') && loopback.has(request.headers.get('host')?.toLowerCase() ?? '')

  const authGrant = (grantId: string, request: Request) => {
    const bots = options.bots()
    const byId = new Map(bots.map(bot => [bot.id, bot]))
    const grant = options.grants.authenticate(grantId, request.headers.get('authorization') ?? '', id => byId.has(id))
    return grant ? { grant, bot: byId.get(grant.botId)! } : null
  }

  async function handleSystem(grant: SessionGrant, bot: { id: string; name: string }, request: Request): Promise<Response> {
    const tracker = grant.scope.kind === 'review' ? options.reviewTracker : undefined
    if (request.method !== 'POST') {
      if (request.method !== 'DELETE') tracker?.recordHardFailure(grant.id)
      return new Response(null, { status: request.method === 'DELETE' ? 204 : 405, headers: { allow: 'POST' } })
    }
    const message = await oneMessage(request)
    if (message instanceof Response) {
      tracker?.recordHardFailure(grant.id)
      return message
    }
    const permitted = scopedToolsFor(grant.scope, options.tools, t3Enabled)
    const permittedNames = new Set(permitted.map(t => t.name))
    switch (message.method) {
      case 'initialize':
        return rpcResult(message.id, {
          protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: scopeInstructions(grant.scope)
        })
      case 'ping':
        return rpcResult(message.id, {})
      case 'tools/list': {
        options.grants.markDiscovered(grant.id, SESSION_SYSTEM_NAME)
        tracker?.markListed(grant.id)
        return rpcResult(message.id, {
          tools: permitted.map(tool => ({
            name: tool.name,
            description: tool.description,
            inputSchema: inputSchema(tool.input),
            annotations: { readOnlyHint: tool.readOnly === true }
          }))
        })
      }
      case 'tools/call':
        return runCall(grant, bot, message, permittedNames, tracker)
      default:
        if (message.id !== undefined) tracker?.recordHardFailure(grant.id)
        return message.id === undefined ? new Response(null, { status: 202 }) : rpcError(message.id, -32601, `${String(message.method)} is not supported.`)
    }
  }

  async function runCall(grant: SessionGrant, bot: { id: string; name: string }, message: JsonRpc, permittedNames: Set<string>, tracker?: ReviewOutcomeTracker): Promise<Response> {
    const fail = (res: Response) => {
      tracker?.recordHardFailure(grant.id)
      return res
    }
    const name = String(message.params?.name ?? '')
    const tool = allTools.get(name)
    if (!tool) return fail(toolError(message.id, `${name} is not a LilBot tool.`))
    const refused = scopedCallRefusal(grant.scope, bot.id, tool, message.params?.arguments, options.beyondOwn, t3Enabled)
    if (refused) return fail(refusedResult(message.id, refused))
    if (!permittedNames.has(tool.name)) return fail(refusedResult(message.id, `${tool.name} is not available in this session.`))
    const primaryChatId = grant.primaryChatId
    if (!primaryChatId) return fail(refusedResult(message.id, 'This session is not bound yet. Try again in a moment.'))
    const isSave = tool.name === 'lilbot_memory_save'
    const isWrite = isSave || tool.name === 'lilbot_memory_forget'
    try {
      const rawArgs = message.params?.arguments ?? {}
      const args = tool.input.parse(rawArgs) as Record<string, unknown>
      if (isWrite) tracker?.recordWriteAttempt(grant.id, isSave)
      const result = await tool.run(bot.id, args, rawArgs, callContext(grant, primaryChatId))
      if (isWrite) tracker?.recordWriteSuccess(grant.id, isSave)
      if (!(typeof tool.readOnly === 'function' ? tool.readOnly(args) : tool.readOnly)) {
        const target = [(result as { id?: unknown } | undefined)?.id, args.botId, args.factId].find(value => typeof value === 'string') ?? ''
        const fields = Object.keys(args).filter(key => !['botId', 'factId', 'requestId'].includes(key))
        options.changes.record({ at: Date.now(), botId: bot.id, botName: bot.name, tool: tool.name, target: String(target), fields: fields.join(', ') })
      }
      return rpcResult(message.id, { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }) }] })
    } catch (error) {
      tracker?.recordError(grant.id, error)
      const text = formatError(error)
      if (!text) console.error(`[scoped-mcp] ${tool.name} failed:`, error instanceof Error ? error.message : error)
      return toolError(message.id, text ?? 'LilBot could not run this tool.')
    }
  }

  async function handleT3(grant: SessionGrant, request: Request): Promise<Response> {
    if (!t3Enabled || !options.t3Forward) return new Response('Not found', { status: 404 })
    if ((grant.scope.kind !== 'webhook' && grant.scope.kind !== 'narrowed') || !grant.scope.capabilities.includes('coding')) {
      return Response.json({ error: 'Coding is not granted for this session.' }, { status: 403 })
    }
    let forwardReq = request
    if (request.method === 'POST') {
      const rawBody = await request.text()
      const parsed = (() => {
        try {
          return JSON.parse(rawBody) as Record<string, unknown>
        } catch {
          return null
        }
      })()
      if (parsed?.method === 'tools/list') options.grants.markDiscovered(grant.id, SESSION_T3_NAME)
      if (parsed?.method === 'tools/call' && !grant.primaryChatId) {
        return refusedResult((parsed.id as string | number | undefined) ?? null, 'This session is not bound yet. Try again in a moment.')
      }
      const rewritten = parsed ? clampT3WaitBody(parsed) : null
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(SCOPED_T3_FETCH_TIMEOUT_MS)])
      forwardReq = new Request(request.url, { method: request.method, headers: request.headers, body: rewritten ?? rawBody, signal })
    }
    return options.t3Forward(grant.botId, forwardReq)
  }

  return async (request: Request, pathname: string): Promise<Response> => {
    if (!checkLoopback(request)) return Response.json({ error: 'Not allowed.' }, { status: 403 })
    const sysMatch = SYSTEM_ROUTE.exec(pathname)
    if (sysMatch) {
      const authed = authGrant(sysMatch[1], request)
      if (!authed) return Response.json({ error: 'Unknown or expired session credential.' }, { status: 403 })
      return handleSystem(authed.grant, authed.bot, request)
    }
    const t3Match = T3_ROUTE.exec(pathname)
    if (t3Match) {
      const authed = authGrant(t3Match[1], request)
      if (!authed) return Response.json({ error: 'Unknown or expired session credential.' }, { status: 403 })
      return handleT3(authed.grant, request)
    }
    return new Response('Not found', { status: 404 })
  }
}
