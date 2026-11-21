/** LilBot's own short MCP conversation with a service: initialize, then list its tools. It tells `add` whether the
 *  service works as it is, asks for a sign-in, or cannot be reached, and gives a signed-in service's tool names. */
import { toolNames } from './mcp-address'
import { boundedFetch, cappedText, rpcMessages, Unreachable } from './mcp-http'

export type Probe = { kind: 'ok'; tools: string[] } | { kind: 'sign_in'; challenge: string } | { kind: 'refused' } | { kind: 'unreachable' }

const PROTOCOL = '2025-06-18'
const PAGES = 10

class Refused extends Error {
  constructor(readonly challenge: string | null) {
    super('refused')
  }
}

export async function probe(address: URL, token?: string): Promise<Probe> {
  let session: string | null = null
  const send = async (message: Record<string, unknown>) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': PROTOCOL }
    if (token) headers.authorization = `Bearer ${token}`
    if (session) headers['mcp-session-id'] = session
    const response = await boundedFetch(address, { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', ...message }) })
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel()
      throw new Refused(response.status === 401 ? (response.headers.get('www-authenticate') ?? '') : null)
    }
    if (!response.ok) {
      await response.body?.cancel()
      throw new Unreachable(String(response.status))
    }
    session = response.headers.get('mcp-session-id') ?? session
    if (!('id' in message)) return null
    const answer = rpcMessages(await cappedText(response), response.headers.get('content-type') ?? '').find(item => item?.id === message.id && typeof item?.method !== 'string')
    if (!answer?.result) throw new Unreachable('no result')
    return answer.result
  }
  try {
    await send({ id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'LilBot', version: '1.0.0' } } })
    await send({ method: 'notifications/initialized' })
    const tools: unknown[] = []
    let cursor: string | undefined
    for (let page = 0; page < PAGES; page++) {
      const result = await send({ id: 2 + page, method: 'tools/list', params: cursor ? { cursor } : {} })
      if (Array.isArray(result.tools)) tools.push(...result.tools)
      cursor = typeof result.nextCursor === 'string' ? result.nextCursor : undefined
      if (!cursor) break
    }
    return { kind: 'ok', tools: toolNames(tools) }
  } catch (error) {
    if (error instanceof Refused) return error.challenge === null || token ? { kind: 'refused' } : { kind: 'sign_in', challenge: error.challenge }
    return { kind: 'unreachable' }
  } finally {
    if (session)
      void boundedFetch(address, { method: 'DELETE', headers: { 'mcp-session-id': session, ...(token ? { authorization: `Bearer ${token}` } : {}) } })
        .then(response => response.body?.cancel())
        .catch(() => {})
  }
}
