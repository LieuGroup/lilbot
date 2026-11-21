/** JSON-RPC answers shared by every MCP endpoint LilBot serves (the T3 bridge, the services' route and the system server). */

export type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any }

export const rpcResult = (id: JsonRpc['id'], result: unknown) => Response.json({ jsonrpc: '2.0', id: id ?? null, result })
export const rpcError = (id: JsonRpc['id'], code: number, message: string) => Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
export const toolError = (id: JsonRpc['id'], text: string) => rpcResult(id, { content: [{ type: 'text', text }], isError: true })

/** Answers a request without the service behind a route: the bot sees one tool that says what to tell Oscar. */
export function signedOutReply(message: JsonRpc, explanation: string, server: string, tool: { name: string; description: string }): Response {
  switch (message.method) {
    case 'initialize':
      return rpcResult(message.id, {
        protocolVersion: typeof message.params?.protocolVersion === 'string' ? message.params.protocolVersion : '2025-06-18',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server, version: '1.0.0' },
        instructions: explanation
      })
    case 'ping':
      return rpcResult(message.id, {})
    case 'tools/list':
      return rpcResult(message.id, { tools: [{ ...tool, inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] })
    case 'tools/call':
      return toolError(message.id, explanation)
    default:
      if (message.id === undefined) return new Response(null, { status: 202 })
      return rpcError(message.id, -32601, explanation)
  }
}

/** One JSON-RPC message from a request body, or the error answer to send instead. */
export async function oneMessage(request: Request): Promise<JsonRpc | Response> {
  let message: JsonRpc
  try {
    message = JSON.parse(await request.text())
  } catch {
    return rpcError(null, -32700, 'Send one JSON-RPC message.')
  }
  return message && typeof message === 'object' && !Array.isArray(message) ? message : rpcError(null, -32600, 'Send one JSON-RPC message.')
}
