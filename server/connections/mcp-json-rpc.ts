/** JSON-RPC answers shared by every MCP endpoint LilBot serves (the T3 bridge and the system server). */

export type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any }

export const rpcResult = (id: JsonRpc['id'], result: unknown) => Response.json({ jsonrpc: '2.0', id: id ?? null, result })
export const rpcError = (id: JsonRpc['id'], code: number, message: string) => Response.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
export const toolError = (id: JsonRpc['id'], text: string) => rpcResult(id, { content: [{ type: 'text', text }], isError: true })
