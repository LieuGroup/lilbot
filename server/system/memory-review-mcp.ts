/** Dedicated narrow Streamable HTTP MCP endpoint for memory-review and pre-compress checkpoint sessions.
 *  Private loopback listener only; authenticates with a separate per-bot `lilbot-memory-review` HMAC key and a live
 *  per-pass `run` id. Exposes strictly `lilbot_memory_recall`, `lilbot_memory_save`, and `lilbot_memory_forget` with
 *  `{ review: true }` hardcoded — zero session matching, zero overlap with the ordinary `lilbot_system` server. */
import { ZodError } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { connectionCaller } from '../connections/connection-keys'
import { type JsonRpc, oneMessage, rpcError, rpcResult, toolError } from '../connections/mcp-json-rpc'
import { REVIEW_DOMAIN_REFUSAL_CODES, type ReviewRunHandle, type ReviewRunSummary } from '../memory/review-run'
import { inputSchema, type McpTool } from './mcp-tool'
import type { SystemChanges } from './system-changes'
import { MEMORY_REVIEW_TOOLS, memoryReviewConnection, SESSION_MCP_KEY_PURPOSE } from './system-connection'

interface MemoryReviewMcpOptions {
  engineToken: string
  port: number
  bots: () => { id: string; name: string }[]
  tools: McpTool[]
  changes: SystemChanges
}

interface LiveRun {
  botId: string
  scope: 'review'
  runId: string
  chatId?: string
  listed: boolean
  hardFailures: number
  writesAttempted: number
  writesSucceeded: number
  savesAttempted: number
  savesSaved: number
  domainRefusals: Record<string, number>
}

const ALLOWED = new Set<string>(MEMORY_REVIEW_TOOLS)
const SERVER_INFO = { name: 'LilBot Memory Review', version: '1.0.0' }
const INSTRUCTIONS =
  'Memory review tools only: recall (lilbot_memory_recall), save (lilbot_memory_save), and forget bot-authored facts (lilbot_memory_forget). Owner-authored facts cannot be forgotten.'

export function createMemoryReviewMcp(options: MemoryReviewMcpOptions) {
  const loopback = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])
  const baseUrl = `http://127.0.0.1:${options.port}`
  const tools = new Map(options.tools.filter(tool => ALLOWED.has(tool.name)).map(tool => [tool.name, tool]))
  const listed = [...tools.values()].map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchema(tool.input),
    annotations: { readOnlyHint: tool.readOnly === true }
  }))
  const runs = new Map<string, LiveRun>()

  function startRun(botId: string): ReviewRunHandle {
    const runId = crypto.randomUUID()
    const live: LiveRun = {
      botId,
      scope: 'review',
      runId,
      listed: false,
      hardFailures: 0,
      writesAttempted: 0,
      writesSucceeded: 0,
      savesAttempted: 0,
      savesSaved: 0,
      domainRefusals: {}
    }
    runs.set(runId, live)
    return {
      runId,
      connection: memoryReviewConnection(baseUrl, options.engineToken, botId, runId),
      setChat: chatId => {
        if (!live.chatId) live.chatId = chatId
      },
      finish: (): ReviewRunSummary => {
        runs.delete(runId)
        return {
          botId: live.botId,
          runId: live.runId,
          listed: live.listed,
          hardFailures: live.hardFailures,
          writesAttempted: live.writesAttempted,
          writesSucceeded: live.writesSucceeded,
          savesAttempted: live.savesAttempted,
          savesSaved: live.savesSaved,
          domainRefusals: { ...live.domainRefusals }
        }
      }
    }
  }

  async function call(caller: { id: string; name: string }, live: LiveRun, message: JsonRpc) {
    const tool = tools.get(message.params?.name)
    if (!tool) {
      live.hardFailures++
      return toolError(message.id, `${String(message.params?.name)} is not available in a memory review.`)
    }
    const rawArgs = message.params?.arguments ?? {}
    let args: Record<string, unknown>
    try {
      args = tool.input.parse(rawArgs) as Record<string, unknown>
    } catch (error) {
      live.hardFailures++
      const msg = error instanceof ZodError ? `Invalid arguments: ${error.issues[0]?.path.join('.') || 'input'} ${error.issues[0]?.message ?? ''}`.trim() : 'Invalid arguments.'
      return toolError(message.id, msg)
    }
    const isSave = tool.name === 'lilbot_memory_save'
    const isForget = tool.name === 'lilbot_memory_forget'
    if (isSave) live.savesAttempted++
    if (isSave || isForget) live.writesAttempted++
    try {
      const result = await tool.run(caller.id, args, rawArgs, { review: true, chatId: live.chatId })
      if (isSave) live.savesSaved++
      if (isSave || isForget) live.writesSucceeded++
      if (!(typeof tool.readOnly === 'function' ? tool.readOnly(args) : tool.readOnly)) {
        const target = [(result as { id?: unknown } | undefined)?.id, args.id].find(value => typeof value === 'string') ?? ''
        const fields = Object.keys(args).filter(key => !['id', 'text'].includes(key))
        options.changes.record({ at: Date.now(), botId: caller.id, botName: caller.name, tool: tool.name, target: String(target), fields: fields.join(', ') })
      }
      return rpcResult(message.id, { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }) }] })
    } catch (error) {
      if (error instanceof LilBotError && REVIEW_DOMAIN_REFUSAL_CODES.has(error.code)) {
        live.domainRefusals[error.code] = (live.domainRefusals[error.code] ?? 0) + 1
        return toolError(message.id, error.message)
      }
      live.hardFailures++
      console.error(`[memory-review-mcp] ${tool.name} failed (${error instanceof LilBotError ? error.code : 'internal'})`)
      return toolError(message.id, error instanceof LilBotError ? error.message : 'LilBot could not run this tool.')
    }
  }

  const handler = async (request: Request): Promise<Response> => {
    if (request.headers.has('origin') || !loopback.has(request.headers.get('host')?.toLowerCase() ?? '')) {
      return Response.json({ error: 'Not allowed.' }, { status: 403 })
    }
    const runId = new URL(request.url).searchParams.get('run') ?? ''
    const live = runId ? runs.get(runId) : undefined
    if (!live) return Response.json({ error: 'No active session run.' }, { status: 403 })
    const caller = options.bots().find(bot => bot.id === live.botId)
    const expectedSubject = `${live.botId}:${live.scope}:${live.runId}`
    const matched = connectionCaller(options.engineToken, SESSION_MCP_KEY_PURPOSE, [expectedSubject], request.headers.get('authorization') ?? '')
    if (!caller || matched !== expectedSubject) return Response.json({ error: 'Unknown session credential.' }, { status: 403 })
    if (request.method !== 'POST') return new Response(null, { status: request.method === 'DELETE' ? 204 : 405, headers: { allow: 'POST' } })

    const message = await oneMessage(request)
    if (message instanceof Response) {
      live.hardFailures++
      return message
    }

    switch (message.method) {
      case 'initialize':
        return rpcResult(message.id, {
          protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS
        })
      case 'ping':
        return rpcResult(message.id, {})
      case 'tools/list':
        live.listed = true
        return rpcResult(message.id, { tools: listed })
      case 'tools/call':
        return call(caller, live, message)
      default:
        if (message.id === undefined) return new Response(null, { status: 202 })
        live.hardFailures++
        return rpcError(message.id, -32601, `${String(message.method)} is not supported.`)
    }
  }

  return { handler, startRun }
}
