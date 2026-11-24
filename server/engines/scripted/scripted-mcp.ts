/** Real HTTP Streamable MCP client helpers for the scripted second engine. */
import type { McpConnection } from '../mcp-connection'

export interface McpCallResult {
  ok: boolean
  text: string
  data?: unknown
}

/** Sends `tools/list` to an MCP endpoint; returns the advertised tool names, or null when discovery failed. */
async function discoverMcpServer(conn: McpConnection): Promise<string[] | null> {
  try {
    const response = await fetch(conn.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.bearerToken}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/list', params: {} })
    })
    if (!response.ok) return null
    const payload = (await response.json()) as { result?: { tools?: { name?: string }[] } }
    if (!Array.isArray(payload.result?.tools)) return null
    return payload.result.tools.map(t => String(t.name ?? '')).filter(Boolean)
  } catch {
    return null
  }
}

export async function callMcpServer(conn: McpConnection, tool: string, args: Record<string, unknown>, onStart: (callId: string) => void): Promise<McpCallResult> {
  const callId = crypto.randomUUID()
  onStart(callId)
  const response = await fetch(conn.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${conn.bearerToken}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: callId, method: 'tools/call', params: { name: tool, arguments: args } })
  })
  if (!response.ok) return { ok: false, text: `HTTP ${response.status}: ${await response.text()}` }
  const payload = (await response.json()) as { result?: { isError?: boolean; content?: { text?: string }[] }; error?: { message?: string } }
  if (payload.error) return { ok: false, text: payload.error.message ?? 'MCP error' }
  const text = payload.result?.content?.[0]?.text ?? ''
  if (payload.result?.isError) return { ok: false, text }
  try {
    const data = JSON.parse(text) as unknown
    if (data && typeof data === 'object' && 'refused' in data && typeof (data as { refused: unknown }).refused === 'string') {
      return { ok: false, text: (data as { refused: string }).refused, data }
    }
    return { ok: true, text, data }
  } catch {
    return { ok: true, text }
  }
}

export async function attachSessionMcp(
  session: { sessionMcp?: McpConnection[]; discoveredTools?: Map<string, string[]> },
  connections: McpConnection[],
  discover: boolean,
  assertReady?: () => void
) {
  session.sessionMcp = connections
  if (!discover) return
  session.discoveredTools = new Map()
  for (const conn of connections) {
    const listed = await discoverMcpServer(conn)
    if (listed) session.discoveredTools.set(conn.name, listed)
  }
  assertReady?.()
}
