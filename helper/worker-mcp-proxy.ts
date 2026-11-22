/** Per-run loopback HTTP MCP proxy (`127.0.0.1:0`) with an ephemeral random bearer token.
 *  Forwards JSON-RPC calls to the leader over the helper's existing signed WebSocket and dies with the run.
 *  Never logs or emits the bearer token. */
import { randomBytes, timingSafeEqual } from 'node:crypto'

const MAX_BODY_BYTES = 262_144

export interface WorkerMcpProxy {
  readonly url: string
  readonly token: string
  respond(callId: string, status: number, body: string): void
  onDisconnect(): void
  close(): void
}

interface PendingCall {
  sent: boolean
  resolve: (value: { status: number; body: string }) => void
  timer: ReturnType<typeof setTimeout>
}

export interface McpProxyOptions {
  send: (callId: string, body: string) => boolean
  retryWindowMs?: number
  retryIntervalMs?: number
  callTimeoutMs?: number
}

const rpcErrorBody = (id: unknown, code: number, message: string) => JSON.stringify({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function readBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return null
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength > MAX_BODY_BYTES) return null
  return new TextDecoder().decode(bytes)
}

export function startWorkerMcpProxy(options: McpProxyOptions): WorkerMcpProxy {
  const token = randomBytes(32).toString('base64url')
  const expectedAuth = Buffer.from(`Bearer ${token}`)
  const retryWindowMs = options.retryWindowMs ?? 15_000
  const retryIntervalMs = options.retryIntervalMs ?? 200
  const callTimeoutMs = options.callTimeoutMs ?? 30_000
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
    maxRequestBodySize: MAX_BODY_BYTES + 1024,
    async fetch(request) {
      const headers = { 'Cache-Control': 'no-store' }
      if (request.headers.has('origin') || !loopback.has(request.headers.get('host')?.toLowerCase() ?? ''))
        return Response.json({ error: 'Not allowed.' }, { status: 403, headers })
      const given = Buffer.from(request.headers.get('authorization') ?? '')
      if (given.length !== expectedAuth.length || !timingSafeEqual(given, expectedAuth)) return Response.json({ error: 'Unauthorized.' }, { status: 403, headers })
      if (request.method === 'DELETE') return new Response(null, { status: 204, headers })
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: { ...headers, allow: 'POST' } })

      const body = await readBody(request)
      if (body === null) return Response.json({ error: 'Payload too large.' }, { status: 413, headers })

      let parsed: { id?: unknown; method?: unknown }
      try {
        parsed = JSON.parse(body) as { id?: unknown; method?: unknown }
      } catch {
        return new Response(rpcErrorBody(null, -32700, 'Invalid JSON.'), { status: 400, headers: { ...headers, 'Content-Type': 'application/json' } })
      }
      // Claude Code probes `server/discover` before `initialize`; answer cleanly without failing.
      if (parsed.method === 'server/discover') {
        if (parsed.id === undefined) return new Response(null, { status: 202, headers })
        return Response.json({ jsonrpc: '2.0', id: parsed.id, result: {} }, { headers })
      }
      if (parsed.id === undefined) return new Response(null, { status: 202, headers })
      if (closed) return new Response(rpcErrorBody(parsed.id, -32000, 'Worker proxy closed.'), { status: 503, headers: { ...headers, 'Content-Type': 'application/json' } })

      const callId = crypto.randomUUID()
      const answer = new Promise<{ status: number; body: string }>(resolve => {
        const timer = setTimeout(() => settle(callId, 504, rpcErrorBody(parsed.id, -32000, 'Leader did not answer in time.')), callTimeoutMs)
        pending.set(callId, { sent: false, resolve, timer })
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
      if (!dispatched) settle(callId, 503, rpcErrorBody(parsed.id, -32000, 'Leader is temporarily unreachable.'))

      const result = await answer
      return new Response(result.body, { status: result.status, headers: { ...headers, 'Content-Type': 'application/json' } })
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
      // Already-transmitted calls cannot be safely re-sent without risking duplicate side effects; fail cleanly so the agent decides.
      for (const [callId, entry] of [...pending]) {
        if (entry.sent) settle(callId, 503, rpcErrorBody(null, -32000, 'Connection to LilBot was interrupted.'))
      }
    },
    close() {
      if (closed) return
      closed = true
      for (const callId of [...pending.keys()]) settle(callId, 503, rpcErrorBody(null, -32000, 'Worker run ended.'))
      server.stop(true)
    }
  }
}
