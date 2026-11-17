/** MCP answers the bridge gives itself: while LilBot is signed out, and for refused tool calls. */
import { createHash } from 'node:crypto'
import { T3_STATUS_TOOL } from './t3-connection'

export type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any }

const SERVER_INFO = { name: 'LilBot T3 Code bridge', version: '1.0.0' }

export const rpcResult = (id: JsonRpc['id'], result: unknown) => Response.json({ jsonrpc: '2.0', id: id ?? null, result })
export const rpcError = (id: JsonRpc['id'], code: number, message: string) => Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
export const toolError = (id: JsonRpc['id'], text: string) => rpcResult(id, { content: [{ type: 'text', text }], isError: true })

/** Answers a request without T3 Code: the bot sees one tool that explains how to renew the sign-in. */
export function signedOutReply(message: JsonRpc, explanation: string): Response {
  switch (message.method) {
    case 'initialize':
      return rpcResult(message.id, {
        protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: explanation
      })
    case 'ping':
      return rpcResult(message.id, {})
    case 'tools/list':
      return rpcResult(message.id, {
        tools: [
          {
            name: T3_STATUS_TOOL,
            description: 'T3 Code coding tools are unavailable: LilBot is not signed in. Call this to learn what to tell Oscar.',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true }
          }
        ]
      })
    case 'tools/call':
      return toolError(message.id, explanation)
    default:
      if (message.id === undefined) return new Response(null, { status: 202 })
      return rpcError(message.id, -32601, explanation)
  }
}

/** One T3 sign-in is shared by every bot, and T3 scopes retry keys to the sign-in. Prefixing a bot's
 *  key with its id keeps two bots' retries apart; the result is stable, so a retry still matches. */
export function scopedRequestId(botId: string, id: string): string {
  const scoped = `lilbot:${botId}:${id}`
  return scoped.length <= 256 ? scoped : `lilbot:${botId}:${createHash('sha256').update(id).digest('hex')}`
}

/** Keeps only allowed tools in a `tools/list` answer, as JSON or as an event stream. */
export function filterToolList(body: string, contentType: string, allowed: ReadonlySet<string>): string {
  const filter = (json: string) => {
    try {
      const value = JSON.parse(json)
      if (Array.isArray(value?.result?.tools)) value.result.tools = value.result.tools.filter((tool: any) => allowed.has(tool?.name))
      return JSON.stringify(value)
    } catch {
      return json
    }
  }
  if (!contentType.includes('text/event-stream')) return filter(body)
  return body
    .split('\n')
    .map(line => (line.startsWith('data:') ? `data: ${filter(line.slice(5).trim())}` : line))
    .join('\n')
}
