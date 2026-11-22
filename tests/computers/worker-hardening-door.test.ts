import { afterEach, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { helperFrame } from '../../helper/frame-auth'
import { connectionHeaders } from '../../helper/identity'
import { startWorkerMcpProxy } from '../../helper/worker-mcp-proxy'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import { createWorkerSocketState, handleOversizedWorkerDone, handleWorkerFrame, type WorkerDoorBridge } from '../../server/computers/worker-door'
import { openDatabase } from '../../server/database/database'
import { startPublicDoor } from '../../server/http/public-door'
import type { WorkerHelperFrame, WorkerLeaderFrame } from '../../shared/worker-frame-schema'
import { until } from '../helpers/until'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

test('F7 & streaming body cap: MCP proxy rejects JSON null, wrong path, concurrent flood, oversized chunked body, and preserves JSON-RPC id on disconnect', async () => {
  const sent: { callId: string; body: string }[] = []
  const proxy = startWorkerMcpProxy({
    send: (callId, body) => {
      sent.push({ callId, body })
      return true
    },
    maxPending: 2,
    callTimeoutMs: 5000
  })
  cleanups.push(() => proxy.close())
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${proxy.token}` }

  // JSON null, array, and non-string method return clean 400 JSON-RPC -32600 (never HTTP 500).
  for (const body of ['null', '[]', '{"jsonrpc":"2.0","id":1,"method":123}']) {
    const res = await fetch(proxy.url, { method: 'POST', headers: auth, body })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: { code: -32600 } })
  }
  // Wrong path or query string returns 404.
  expect((await fetch(proxy.url.replace('/mcp', '/wrong'), { method: 'POST', headers: auth, body: '{}' })).status).toBe(404)
  expect((await fetch(`${proxy.url}?a=1`, { method: 'POST', headers: auth, body: '{}' })).status).toBe(404)

  // Streaming chunked body exceeding 256 KiB returns 413 without Content-Length.
  const bigStream = new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(new Uint8Array(150_000))
      ctrl.enqueue(new Uint8Array(150_000))
      ctrl.close()
    }
  })
  expect((await fetch(proxy.url, { method: 'POST', headers: auth, body: bigStream })).status).toBe(413)

  // Concurrency cap (maxPending = 2) rejects 3rd in-flight call with 429 and preserves JSON-RPC id on disconnect.
  const r1 = fetch(proxy.url, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 42, method: 'ping' }) })
  const r2 = fetch(proxy.url, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 'req-b', method: 'ping' }) })
  await until(() => sent.length === 2)
  const r3 = await fetch(proxy.url, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 99, method: 'ping' }) })
  expect(r3.status).toBe(429)
  expect(await r3.json()).toMatchObject({ id: 99 })
  proxy.onDisconnect()
  expect(await (await r1).json()).toMatchObject({ id: 42 })
  expect(await (await r2).json()).toMatchObject({ id: 'req-b' })
})

test('F6 & F13: worker-door prunes leader-ended runs, caps oversized worker.done at 1 MiB, and rate-limits worker.mcp.request per run', () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-door-unit-'))
  const db = openDatabase(join(root, 'lilbot.db'))
  cleanups.push(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  const activeRuns = new Set<string>()
  const delivered: WorkerHelperFrame[] = []
  const replies: WorkerLeaderFrame[] = []
  const bridge: WorkerDoorBridge = {
    hasRun: (_c, id) => activeRuns.has(id),
    onFrame: (_c, frame) => delivered.push(frame)
  }
  const send = (frame: WorkerLeaderFrame) => {
    replies.push(frame)
    return true
  }
  const state = createWorkerSocketState()

  // F6: 4 runs end on leader before worker.done; 5th active run prunes stale keys instead of returning false (1008).
  for (let i = 1; i <= 4; i++) {
    const id = `stale-${i}`
    activeRuns.add(id)
    expect(handleWorkerFrame(db, 'c1', { type: 'worker.event', runId: id, activity: 'x' }, state, 1000, 64, send, bridge)).toBe(true)
    activeRuns.delete(id)
  }
  activeRuns.add('active-5')
  expect(handleWorkerFrame(db, 'c1', { type: 'worker.event', runId: 'active-5', activity: 'y' }, state, 2000, 64, send, bridge)).toBe(true)
  expect(state.events.size).toBe(1)

  // F13: per-run MCP rate limit (burst 10) replies 429 with preserved JSON-RPC id on the 11th immediate call.
  for (let i = 0; i < 12; i++) {
    expect(
      handleWorkerFrame(
        db,
        'c1',
        { type: 'worker.mcp.request', runId: 'active-5', callId: `c-${i}`, body: JSON.stringify({ jsonrpc: '2.0', id: i + 1, method: 'ping' }) },
        state,
        2000,
        100,
        send,
        bridge
      )
    ).toBe(true)
  }
  const limited = replies.filter(r => r.type === 'worker.mcp.response' && r.status === 429)
  expect(limited).toHaveLength(2)
  expect(JSON.parse((limited[0] as Extract<WorkerLeaderFrame, { type: 'worker.mcp.response' }>).body)).toMatchObject({ id: 11 })

  // F13: oversized worker.done (> 1 MiB) is replaced with a bounded failed outcome and acked before heavy Zod parse.
  expect(handleOversizedWorkerDone('c1', { type: 'worker.done', runId: 'active-5' }, 1_200_000, state, send, bridge)).toBe(true)
  expect(delivered.at(-1)).toMatchObject({ type: 'worker.done', runId: 'active-5', status: 'failed', error: 'Worker outcome exceeded size limit.' })
  expect(replies.at(-1)).toEqual({ type: 'worker.ack', runId: 'active-5' })
})

test('F10: unproven contender socket cannot take over workers.onConnect or inject worker frames while active peer is live', async () => {
  const root = mkdtempSync(join(tmpdir(), 'worker-contender-'))
  const db = openDatabase(join(root, 'lilbot.db'))
  const store = new ComputerStore(db)
  const serverKey = loadServerKey(root)
  const service = new ComputerService(
    store,
    serverKey,
    () => true,
    () => root,
    () => {},
    () => 'full-access'
  )
  const pair = generateKeyPairSync('ed25519')
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  store.add('box', { name: 'Box', os: 'linux', home: root, capabilities: ['exec'] }, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString())

  let connectCalls = 0
  const seenFrames: WorkerHelperFrame[] = []
  const door = startPublicDoor(service, 0, {
    workers: {
      hasRun: () => true,
      onConnect: () => {
        connectCalls++
        return () => {}
      },
      onFrame: (_c, frame) => seenFrames.push(frame)
    }
  })
  const identity = { id: 'box', url: `http://127.0.0.1:${door.port}`, privateKey, serverFingerprint: serverKey.fingerprint }
  const h1 = connectionHeaders(identity)
  const ws1 = new WebSocket(`ws://127.0.0.1:${door.port}/helper/connect`, { headers: h1 } as any)
  await new Promise<void>(resolve => ws1.addEventListener('open', () => resolve(), { once: true }))
  await until(() => connectCalls === 1)

  const h2 = connectionHeaders(identity)
  const ws2 = new WebSocket(`ws://127.0.0.1:${door.port}/helper/connect`, { headers: h2 } as any)
  await new Promise<void>(resolve => ws2.addEventListener('open', () => resolve(), { once: true }))
  ws2.send(helperFrame(privateKey, 'box', h2['x-lilbot-nonce'], 0, JSON.stringify({ type: 'worker.capabilities', agents: [{ driver: 'claude-code', version: '9.9.9' }] })))
  ws2.send(helperFrame(privateKey, 'box', h2['x-lilbot-nonce'], 1, JSON.stringify({ type: 'worker.event', runId: 'r1', activity: 'hijacked' })))
  await Bun.sleep(200)

  expect(connectCalls).toBe(1)
  expect(seenFrames).toEqual([])
  expect(service.list().find(c => c.id === 'box')?.workerAgents).toBeUndefined()

  ws1.close()
  ws2.close()
  door.stop(true)
  service.close()
  db.close()
  rmSync(root, { recursive: true, force: true })
})
