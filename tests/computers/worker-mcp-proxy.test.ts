import { expect, test } from 'bun:test'
import { startWorkerMcpProxy } from '../../helper/worker-mcp-proxy'

test('MCP proxy enforces loopback Host, no Origin, constant-time bearer auth, 256 KiB cap, server/discover, and dies on close', async () => {
  const sent: { callId: string; body: string }[] = []
  let online = false
  const proxy = startWorkerMcpProxy({
    send: (callId, body) => {
      if (!online) return false
      sent.push({ callId, body })
      queueMicrotask(() => proxy.respond(callId, 200, JSON.stringify({ jsonrpc: '2.0', id: 10, result: { echoed: true } })))
      return true
    },
    retryWindowMs: 1000,
    retryIntervalMs: 25
  })
  try {
    expect(proxy.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/)
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${proxy.token}` }

    // Missing/wrong auth, Origin header, non-loopback Host, oversized payload, and non-POST are refused.
    expect((await fetch(proxy.url, { method: 'POST', body: '{}' })).status).toBe(403)
    expect((await fetch(proxy.url, { method: 'POST', headers: { Authorization: 'Bearer nope' }, body: '{}' })).status).toBe(403)
    expect((await fetch(proxy.url, { method: 'POST', headers: { ...auth, Origin: 'http://evil.test' }, body: '{}' })).status).toBe(403)
    expect((await fetch(proxy.url, { method: 'POST', headers: { ...auth, Host: 'evil.example:80' }, body: '{}' })).status).toBe(403)
    expect((await fetch(proxy.url, { method: 'GET', headers: auth })).status).toBe(405)
    expect((await fetch(proxy.url, { method: 'DELETE', headers: auth })).status).toBe(204)
    expect((await fetch(proxy.url, { method: 'POST', headers: auth, body: 'x'.repeat(262_145) })).status).toBe(413)

    // Claude Code's pre-initialize `server/discover` and notifications succeed without round-tripping to the leader.
    const disc = await fetch(proxy.url, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover' }) })
    expect(disc.status).toBe(200)
    expect(await disc.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} })
    expect((await fetch(proxy.url, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) })).status).toBe(202)
    expect(sent).toHaveLength(0)

    // A call arriving while disconnected retries briefly and succeeds once the socket returns; bearer token never crosses the wire.
    setTimeout(() => (online = true), 60)
    const ok = await fetch(proxy.url, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'ping' }) })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({ jsonrpc: '2.0', id: 10, result: { echoed: true } })
    expect(sent).toHaveLength(1)
    expect(JSON.stringify(sent)).not.toContain(proxy.token)
  } finally {
    proxy.close()
  }
  // Proxy dies with the run: nothing listens afterward.
  await expect(fetch(proxy.url, { method: 'POST' })).rejects.toThrow()
})

test('MCP proxy fails already-transmitted calls cleanly on disconnect instead of re-sending side effects', async () => {
  let sentCount = 0
  const proxy = startWorkerMcpProxy({
    send: () => {
      sentCount++
      return true
    },
    callTimeoutMs: 5000
  })
  try {
    const req = fetch(proxy.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${proxy.token}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_memory_save' } })
    })
    await Bun.sleep(40)
    proxy.onDisconnect()
    const res = await req
    expect(res.status).toBe(503)
    expect(sentCount).toBe(1)
  } finally {
    proxy.close()
  }
})
