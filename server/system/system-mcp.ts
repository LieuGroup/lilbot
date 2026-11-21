/** LilBot's own MCP server: the tools through which a bot operates the app. Streamable HTTP, answered
 *  as plain JSON, on the private listener only (never the Access listener or the helper door).
 *
 *  Every call carries the calling bot's own key (`connection-keys.ts`); that key, not any argument,
 *  says who is calling. Each tool calls the same service function the screen uses, so the rules and
 *  `bots.changed` pushes are the same, and every change a tool makes is logged against the calling bot. */
import { ZodError } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { connectionCaller } from '../connections/connection-keys'
import { type JsonRpc, oneMessage, refusedResult, rpcError, rpcResult, toolError } from '../connections/mcp-json-rpc'
import { inputSchema, type McpTool } from './mcp-tool'
import type { SystemChanges } from './system-changes'
import { SYSTEM_KEY_PURPOSE } from './system-connection'

interface SystemMcpOptions {
  engineToken: string
  port: number
  /** Current (not deleted) bots. */
  bots: () => { id: string; name: string }[]
  tools: McpTool[]
  changes: SystemChanges
  /** What an engine that shows an MCP server's instructions tells the model about these tools. */
  instructions: string
  /** Why the calling session may not make this call (a check session, `check-access.ts`; a webhook run, `run-access.ts`), or null. */
  refusal: (botId: string, tool: string, args: unknown) => Promise<string | null>
}

const SERVER_INFO = { name: 'LilBot', version: '1.0.0' }

const refusal = (error: unknown) => {
  if (error instanceof LilBotError) return error.message
  if (error instanceof ZodError) return `Invalid arguments: ${error.issues[0]?.path.join('.') || 'input'} ${error.issues[0]?.message ?? ''}`.trim()
  return undefined
}

export function createSystemMcp(options: SystemMcpOptions) {
  const loopback = new Set([`127.0.0.1:${options.port}`, `localhost:${options.port}`])
  const tools = new Map(options.tools.map(tool => [tool.name, tool]))
  const listed = options.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchema(tool.input),
    annotations: { readOnlyHint: tool.readOnly === true }
  }))

  async function call(caller: { id: string; name: string }, message: JsonRpc) {
    const tool = tools.get(message.params?.name)
    if (!tool) return toolError(message.id, `${String(message.params?.name)} is not a LilBot tool.`)
    const refused = await options.refusal(caller.id, tool.name, message.params?.arguments)
    if (refused) return refusedResult(message.id, refused)
    try {
      const args = tool.input.parse(message.params?.arguments ?? {}) as Record<string, unknown>
      const result = await tool.run(caller.id, args)
      if (!(typeof tool.readOnly === 'function' ? tool.readOnly(args) : tool.readOnly)) {
        const target = [(result as { id?: unknown } | undefined)?.id, args.botId, args.factId].find(value => typeof value === 'string') ?? ''
        const fields = Object.keys(args).filter(key => !['botId', 'factId', 'requestId'].includes(key))
        options.changes.record({ at: Date.now(), botId: caller.id, botName: caller.name, tool: tool.name, target: String(target), fields: fields.join(', ') })
      }
      return rpcResult(message.id, { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }) }] })
    } catch (error) {
      const text = refusal(error)
      if (!text) console.error(`[system] ${tool.name} failed:`, error instanceof Error ? error.message : error)
      return toolError(message.id, text ?? 'LilBot could not run this tool.')
    }
  }

  return async (request: Request): Promise<Response> => {
    // Only engine processes on this machine: loopback Host, never a browser, and a current bot's own key.
    if (request.headers.has('origin') || !loopback.has(request.headers.get('host')?.toLowerCase() ?? '')) return Response.json({ error: 'Not allowed.' }, { status: 403 })
    const bots = options.bots()
    const callerId = connectionCaller(
      options.engineToken,
      SYSTEM_KEY_PURPOSE,
      bots.map(bot => bot.id),
      request.headers.get('authorization') ?? ''
    )
    const caller = bots.find(bot => bot.id === callerId)
    if (!caller) return Response.json({ error: 'Unknown bot credential.' }, { status: 403 })
    if (request.method !== 'POST') return new Response(null, { status: request.method === 'DELETE' ? 204 : 405, headers: { allow: 'POST' } })

    const message = await oneMessage(request)
    if (message instanceof Response) return message

    switch (message.method) {
      case 'initialize':
        return rpcResult(message.id, {
          protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: options.instructions
        })
      case 'ping':
        return rpcResult(message.id, {})
      case 'tools/list':
        return rpcResult(message.id, { tools: listed })
      case 'tools/call':
        return call(caller, message)
      default:
        return message.id === undefined ? new Response(null, { status: 202 }) : rpcError(message.id, -32601, `${String(message.method)} is not supported.`)
    }
  }
}
