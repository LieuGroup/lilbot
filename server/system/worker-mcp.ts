/** Scoped MCP server for remote coding workers over the helper's signed WebSocket.
 *  Uses an explicit 6-tool allow-list (work board scoped to the worker's own item, own work list, own memory read,
 *  bot-private memory save with per-run cap, offered skill read, and guide). Never exposes `lilbot_status`, bot CRUD,
 *  delegation, groups, connections, routines, webhooks, shared memory writes, or leader files. */
import { ZodError } from 'zod'
import { LilBotError } from '../../shared/lilbot-error'
import { WorkInput, type WorkItem } from '../../shared/work-schema'
import { REMOTE_WORKER_EXCLUDED_SKILLS } from '../computers/remote-worker-prompt'
import type { RemoteWorkerMcpContext } from '../computers/remote-worker-types'
import type { JsonRpc } from '../connections/mcp-json-rpc'
import { fenceRunText } from '../work/webhook-items'
import { inputSchema, type McpTool } from './mcp-tool'
import type { SystemDeps } from './system-deps'

const MAX_BODY_BYTES = 262_144
export const MAX_MEMORY_SAVES_PER_RUN = 10
const MAX_TRACKED_RUNS = 500
const SERVER_INFO = { name: 'LilBot Worker', version: '1.0.0' }
const INSTRUCTIONS =
  'Scoped LilBot tools for your remote worker session: report on your own work item (lilbot_work), list your own work items (lilbot_work_list), read your memory (lilbot_memory_list), save bot-private memory (lilbot_memory_save), read shared skills (lilbot_skill_read), and read LilBot guides (lilbot_guide).'

/** Explicit allow-list of system tools a remote worker may invoke. Every other system tool is refused. */
export const REMOTE_WORKER_TOOLS = ['lilbot_work', 'lilbot_work_list', 'lilbot_memory_list', 'lilbot_memory_save', 'lilbot_skill_read', 'lilbot_guide'] as const

const ALLOWED_SET = new Set<string>(REMOTE_WORKER_TOOLS)

const jsonOk = (id: JsonRpc['id'], result: unknown) => ({ status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: id ?? null, result }) })
const jsonErr = (id: JsonRpc['id'], code: number, message: string, status = 200) => ({
  status,
  body: JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
})
const toolErr = (id: JsonRpc['id'], text: string) => jsonOk(id, { content: [{ type: 'text', text }], isError: true })

const errorText = (error: unknown) => {
  if (error instanceof LilBotError) return error.message
  if (error instanceof ZodError) return `Invalid arguments: ${error.issues[0]?.path.join('.') || 'input'} ${error.issues[0]?.message ?? ''}`.trim()
  return undefined
}

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

export function createWorkerMcp(deps: Pick<SystemDeps, 'store' | 'work' | 'changes' | 'workerAllowMemory'>, allTools: McpTool[]) {
  const allowed = new Map(allTools.filter(t => ALLOWED_SET.has(t.name)).map(t => [t.name, t]))
  const listed = [...allowed.values()].map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: inputSchema(tool.input),
    annotations: { readOnlyHint: tool.readOnly === true }
  }))
  const memorySaves = new Map<string, number>()

  const bounded = (id: JsonRpc['id'], res: { status: number; body: string }) =>
    Buffer.byteLength(res.body, 'utf8') <= MAX_BODY_BYTES ? res : toolErr(id, 'Tool response exceeded the remote worker size limit.')

  async function callTool(ctx: RemoteWorkerMcpContext, msg: JsonRpc): Promise<{ status: number; body: string }> {
    const bot = deps.store.list().find(b => b.id === ctx.botId)
    if (!bot) return toolErr(msg.id, 'Bot is no longer available.')
    const name = typeof msg.params?.name === 'string' ? msg.params.name : ''
    const tool = allowed.get(name)
    if (!tool) return toolErr(msg.id, `${name || 'unknown'} is not allowed in a remote worker.`)

    const rawArgs = msg.params?.arguments ?? {}
    if (!isRecord(rawArgs)) return toolErr(msg.id, 'Tool arguments must be a JSON object.')

    try {
      let result: unknown
      let parsedArgs: Record<string, unknown>
      if (name === 'lilbot_work') {
        if (rawArgs.verdict !== undefined) return toolErr(msg.id, 'A remote worker cannot submit check verdicts.')
        if (rawArgs.itemId !== ctx.threadId) return toolErr(msg.id, `A remote worker can only update its own work item (${ctx.threadId}).`)
        const parsed = WorkInput.parse(rawArgs)
        parsedArgs = parsed as unknown as Record<string, unknown>
        result = fenceRunText(await deps.work.actFrom(ctx.botId, parsed, ctx.chatId), deps.work.host.isNarrowedOrigin)
      } else if (name === 'lilbot_work_list') {
        if (rawArgs.mine === false || rawArgs.goals !== undefined || rawArgs.goalId !== undefined)
          return toolErr(msg.id, "A remote worker can only read its own bot's work items (no mine: false or goals).")
        if (rawArgs.itemId !== undefined && (typeof rawArgs.itemId !== 'string' || deps.work.store.get(rawArgs.itemId)?.ownerId !== ctx.botId))
          return toolErr(msg.id, "A remote worker can only read its own bot's work items.")
        parsedArgs = tool.input.parse({ ...rawArgs, mine: true }) as Record<string, unknown>
        const raw = await tool.run(ctx.botId, parsedArgs)
        result =
          rawArgs.itemId !== undefined && isRecord(raw) && Array.isArray((raw as unknown as WorkItem).children)
            ? { ...raw, children: (raw as unknown as WorkItem).children.filter(c => c.ownerId === ctx.botId) }
            : raw
      } else if (name === 'lilbot_memory_list') {
        if (deps.workerAllowMemory && !deps.workerAllowMemory(ctx.threadId)) return toolErr(msg.id, 'This narrowed remote worker cannot read memory.')
        if (rawArgs.botId !== undefined && rawArgs.botId !== ctx.botId) return toolErr(msg.id, "A remote worker can only read its own bot's memory.")
        parsedArgs = tool.input.parse({}) as Record<string, unknown>
        result = await tool.run(ctx.botId, parsedArgs)
      } else if (name === 'lilbot_memory_save') {
        if (deps.workerAllowMemory && !deps.workerAllowMemory(ctx.threadId)) return toolErr(msg.id, 'This narrowed remote worker cannot save memory.')
        if (rawArgs.scope !== undefined && rawArgs.scope !== 'bot') return toolErr(msg.id, 'A remote worker can only save bot-private memory (scope "bot"), never shared memory.')
        const count = memorySaves.get(ctx.runId) ?? 0
        if (count >= MAX_MEMORY_SAVES_PER_RUN) return toolErr(msg.id, `Remote worker memory save limit (${MAX_MEMORY_SAVES_PER_RUN} per run) reached.`)
        parsedArgs = tool.input.parse({ ...rawArgs, scope: 'bot' }) as Record<string, unknown>
        result = await tool.run(ctx.botId, parsedArgs)
        if (!memorySaves.has(ctx.runId) && memorySaves.size >= MAX_TRACKED_RUNS) memorySaves.delete(memorySaves.keys().next().value!)
        memorySaves.set(ctx.runId, count + 1)
      } else if (name === 'lilbot_skill_read') {
        if (typeof rawArgs.name === 'string' && REMOTE_WORKER_EXCLUDED_SKILLS.has(rawArgs.name))
          return toolErr(msg.id, `Skill "${rawArgs.name}" is not available in a remote worker.`)
        parsedArgs = tool.input.parse(rawArgs) as Record<string, unknown>
        const raw = await tool.run(ctx.botId, parsedArgs)
        result =
          !parsedArgs.name && isRecord(raw) && Array.isArray(raw.skills)
            ? { ...raw, skills: raw.skills.filter(s => !isRecord(s) || typeof s.name !== 'string' || !REMOTE_WORKER_EXCLUDED_SKILLS.has(s.name)) }
            : raw
      } else {
        parsedArgs = tool.input.parse(rawArgs) as Record<string, unknown>
        result = await tool.run(ctx.botId, parsedArgs)
      }

      if (!(typeof tool.readOnly === 'function' ? tool.readOnly(parsedArgs) : tool.readOnly)) {
        const target = [(result as { id?: unknown } | undefined)?.id, parsedArgs.itemId, parsedArgs.factId].find(v => typeof v === 'string') ?? ''
        const fields = Object.keys(parsedArgs).filter(k => !['botId', 'factId', 'requestId'].includes(k))
        deps.changes.record({ at: Date.now(), botId: bot.id, botName: bot.name, tool: tool.name, target: String(target), fields: fields.join(', ') })
      }
      return bounded(msg.id, jsonOk(msg.id, { content: [{ type: 'text', text: JSON.stringify(result ?? { ok: true }) }] }))
    } catch (error) {
      const text = errorText(error)
      if (!text) console.error(`[remote-worker-mcp] ${tool.name} failed:`, error instanceof Error ? error.message : error)
      return toolErr(msg.id, text ?? 'LilBot could not run this tool.')
    }
  }

  return async (ctx: RemoteWorkerMcpContext, rawBody: string): Promise<{ status: number; body: string }> => {
    if (Buffer.byteLength(rawBody, 'utf8') > MAX_BODY_BYTES) return jsonErr(null, -32600, 'Payload too large.', 413)
    let parsed: unknown
    try {
      parsed = JSON.parse(rawBody)
    } catch {
      return jsonErr(null, -32700, 'Send one JSON-RPC message.', 400)
    }
    if (!isRecord(parsed) || typeof parsed.method !== 'string') return jsonErr(null, -32600, 'Send one JSON-RPC message.', 400)
    const msg = parsed as JsonRpc
    if (msg.id === undefined) return { status: 202, body: '' }

    switch (msg.method) {
      case 'initialize':
        return jsonOk(msg.id, {
          protocolVersion: typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS
        })
      case 'ping':
        return jsonOk(msg.id, {})
      case 'tools/list':
        return jsonOk(msg.id, { tools: listed })
      case 'tools/call':
        return callTool(ctx, msg)
      default:
        return jsonErr(msg.id, -32601, `${String(msg.method)} is not supported.`)
    }
  }
}
