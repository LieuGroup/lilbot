/** Per-run loopback HTTP MCP proxy (`127.0.0.1:0`) with an ephemeral random bearer token.
 *  Forwards JSON-RPC calls to the leader over the helper's existing signed WebSocket and dies with the run.
 *  Never logs or emits the bearer token. */
import { randomBytes, timingSafeEqual } from 'node:crypto'

const MAX_BODY_BYTES = 262_144
const MAX_PENDING_CALLS = 16
const HEADERS = { 'Cache-Control': 'no-store' }
const JSON_HEADERS = { ...HEADERS, 'Content-Type': 'application/json' }

export interface WorkerMcpProxy {
  readonly url: string
  readonly token: string
  respond(callId: string, status: number, body: string): void
  onDisconnect(): void
  close(): void
}

interface PendingCall {
  id: unknown
  sent: boolean
  resolve: (value: { status: number; body: string }) => void
  timer: ReturnType<typeof setTimeout>
}

export interface McpProxyOptions {
  send: (callId: string, body: string) => boolean
  retryWindowMs?: number
  retryIntervalMs?: number
  callTimeoutMs?: number
  maxPending?: number
}

const rpcErrorBody = (id: unknown, code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

/** Streaming size-limited body read: cancels immediately once cumulative bytes pass `limit`. */
async function readLimitedBody(request: Request, limit: number): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > limit) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

export function startWorkerMcpProxy(options: McpProxyOptions): WorkerMcpProxy {
  const token = randomBytes(32).toString('base64url')
  const expectedAuth = Buffer.from(`Bearer ${token}`)
  const retryWindowMs = options.retryWindowMs ?? 15_000
  const retryIntervalMs = options.retryIntervalMs ?? 200
  const callTimeoutMs = options.callTimeoutMs ?? 30_000
  const maxPending = options.maxPending ?? MAX_PENDING_CALLS
  const pending = new Map<string, PendingCall>()
  let closed = false

  const settle = (callId: string, status: number, body: string) => {
    const entry = pending.get(callId)
    if (!entry) return
    pending.delete(callId)
    clearTimeout(entry.timer)
    entry.resolve({ status, body })
  }

  let loopback = new Set<string>()
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    development: false,
    idleTimeout: 30,
    maxRequestBodySize: MAX_BODY_BYTES + 1024,
    error: () => new Response('Internal server error', { status: 500, headers: HEADERS }),
    async fetch(request) {
      if (request.headers.has('origin') || !loopback.has(request.headers.get('host')?.toLowerCase() ?? ''))
        return Response.json({ error: 'Not allowed.' }, { status: 403, headers: HEADERS })
      const given = Buffer.from(request.headers.get('authorization') ?? '')
      if (given.length !== expectedAuth.length || !timingSafeEqual(given, expectedAuth)) return Response.json({ error: 'Unauthorized.' }, { status: 403, headers: HEADERS })
      const url = new URL(request.url)
      if (url.pathname !== '/mcp' || url.search) return Response.json({ error: 'Not found.' }, { status: 404, headers: HEADERS })
      if (request.method === 'DELETE') return new Response(null, { status: 204, headers: HEADERS })
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...HEADERS, allow: 'POST' } })

      const body = await readLimitedBody(request, MAX_BODY_BYTES)
      if (body === null) return Response.json({ error: 'Payload too large.' }, { status: 413, headers: HEADERS })

      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        return new Response(rpcErrorBody(null, -32700, 'Invalid JSON.'), { status: 400, headers: JSON_HEADERS })
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || typeof (parsed as { method?: unknown }).method !== 'string') {
        return new Response(rpcErrorBody(null, -32600, 'Invalid Request.'), { status: 400, headers: JSON_HEADERS })
      }
      const rpc = parsed as { id?: unknown; method: string }
      // Claude Code probes `server/discover` before `initialize`; answer cleanly without failing.
      if (rpc.method === 'server/discover') {
        if (rpc.id === undefined) return new Response(null, { status: 202, headers: HEADERS })
        return Response.json({ jsonrpc: '2.0', id: rpc.id, result: {} }, { headers: HEADERS })
      }
      if (rpc.id === undefined) return new Response(null, { status: 202, headers: HEADERS })
      if (closed) return new Response(rpcErrorBody(rpc.id, -32000, 'Worker proxy closed.'), { status: 503, headers: JSON_HEADERS })
      if (pending.size >= maxPending) return new Response(rpcErrorBody(rpc.id, -32000, 'Too many concurrent MCP requests.'), { status: 429, headers: JSON_HEADERS })

      const callId = crypto.randomUUID()
      const answer = new Promise<{ status: number; body: string }>(resolve => {
        const timer = setTimeout(() => settle(callId, 504, rpcErrorBody(rpc.id, -32000, 'Leader did not answer in time.')), callTimeoutMs)
        pending.set(callId, { id: rpc.id, sent: false, resolve, timer })
      })

      const deadline = Date.now() + retryWindowMs
      let dispatched = false
      while (!closed && pending.has(callId)) {
        if (options.send(callId, body)) {
          dispatched = true
          const entry = pending.get(callId)
          if (entry) entry.sent = true
          break
        }
        if (Date.now() >= deadline) break
        await Bun.sleep(retryIntervalMs)
      }
      if (!dispatched) settle(callId, 503, rpcErrorBody(rpc.id, -32000, 'Leader is temporarily unreachable.'))

      const result = await answer
      return new Response(result.body, { status: result.status, headers: JSON_HEADERS })
    }
  })

  loopback = new Set([`127.0.0.1:${server.port}`, `localhost:${server.port}`])

  return {
    url: `http://127.0.0.1:${server.port}/mcp`,
    token,
    respond(callId, status, body) {
      settle(callId, status, body)
    },
    onDisconnect() {
      // Already-transmitted calls cannot be safely re-sent without risking duplicate side effects; preserve each JSON-RPC id.
      for (const [callId, entry] of [...pending]) {
        if (entry.sent) settle(callId, 503, rpcErrorBody(entry.id, -32000, 'Connection to LilBot was interrupted.'))
      }
    },
    close() {
      if (closed) return
      closed = true
      for (const [callId, entry] of [...pending]) settle(callId, 503, rpcErrorBody(entry.id, -32000, 'Worker run ended.'))
      server.stop(true)
    }
  }
}
