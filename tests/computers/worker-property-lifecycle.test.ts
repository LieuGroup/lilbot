import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connectionHeaders } from '../../helper/identity'
import { run } from '../../helper/runner'
import { claudeCodeDriver } from '../../helper/worker-driver-claude'
import { WorkerHost } from '../../helper/worker-host'
import { finishWorkerRecord, prepareWorkerJournal } from '../../helper/worker-journal'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import type { WorkerDoorBridge } from '../../server/computers/worker-door'
import { openDatabase } from '../../server/database/database'
import { startPublicDoor } from '../../server/http/public-door'
import { HelperFrame } from '../../shared/computer-schema'
import type { WorkerDoneFrame, WorkerHelperFrame, WorkerLeaderFrame } from '../../shared/worker-frame-schema'
import { until } from '../helpers/until'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-life-'))
  roots.push(dir)
  return dir
}
const writeScript = (dir: string, name: string, body: string, mode = 0o700) => {
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bun\n${body}\n`, { mode })
  return path
}
const pidAlive = (pid: number) => {
  try {
    return process.kill(pid, 0)
  } catch {
    return false
  }
}

test('property (b): every run termination mode leaves zero leaked process, proxy, config file, or slot and emits one valid worker.done', async () => {
  const dir = tempDir()
  const db = new Database(join(dir, 'requests.db'))
  const [pidFile, proxyFile, tokenFile] = ['child.pid', 'proxy.url', 'proxy.tok'].map(n => join(dir, n)) as [string, string, string]
  const makeAgent = (name: string, body: string, mode = 0o700) =>
    writeScript(
      dir,
      name,
      `import { readFileSync, writeFileSync } from 'node:fs'
const a = process.argv.slice(2), mcp = JSON.parse(readFileSync(a[a.indexOf('--mcp-config') + 1], 'utf8')).mcpServers.lilbot_system
if (mcp) { writeFileSync(${JSON.stringify(proxyFile)}, mcp.url); writeFileSync(${JSON.stringify(tokenFile)}, mcp.headers.Authorization.slice(7)) }
${body}`,
      mode
    )
  const spawnSleeper = `const c = Bun.spawn(['sleep', '30'], { stdout: 'ignore', stderr: 'ignore' }); writeFileSync(${JSON.stringify(pidFile)}, String(c.pid)); console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-live' })); setInterval(() => {}, 1000)`

  const cases: [string, string, WorkerDoneFrame['status'], { mode?: number; cwd?: string; action?: 'stop' | 'revoke' }?][] = [
    ['ok', `console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's1', result: 'ok' }))`, 'completed'],
    ['err', `console.log(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: 'refused' }))`, 'failed'],
    ['nonzero', `console.error('boom'); process.exit(2)`, 'failed'],
    ['silent0', `process.exit(0)`, 'failed'],
    [
      'hostile',
      `const t = mcp.headers.Authorization.slice(7); console.log('null'); console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: t, result: 'x ' + t.slice(0,10) + '\\u0000' + t.slice(10), usage: { input_tokens: 1e25 } }))`,
      'completed'
    ],
    [
      'setsid',
      `console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's2', result: 'fast' })); Bun.spawn(['setsid', 'sleep', '3'], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }); process.exit(0)`,
      'completed'
    ],
    ['stop-mid', spawnSleeper, 'stopped', { action: 'stop' }],
    ['revoke-mid', spawnSleeper, 'stopped', { action: 'revoke' }],
    ['nonexec', 'process.exit(0)', 'failed', { mode: 0o644 }],
    ['badcwd', 'process.exit(0)', 'failed', { cwd: join(dir, 'missing') }]
  ]

  for (const [name, body, expectStatus, extra] of cases) {
    for (const f of [pidFile, proxyFile, tokenFile]) rmSync(f, { force: true })
    const frames: unknown[] = []
    const host = new WorkerHost({
      db,
      configDir: dir,
      drivers: [claudeCodeDriver({ bin: makeAgent(name, body, extra?.mode), configDir: dir, killGraceMs: 150, drainTimeoutMs: 150 })],
      coalesceMs: 10,
      send: (_k, f) => frames.push(f),
      emitNow: () => true
    })
    const runId = `life-${name}`
    host.handle({ type: 'worker.start', runId, cwd: extra?.cwd ?? dir, model: 'claude-sonnet-5-5', prompt: 'go', mcpEnabled: true })
    if (extra?.action) {
      await until(() => existsSync(pidFile))
      if (extra.action === 'stop') host.handle({ type: 'worker.stop', runId })
      else host.stopAll()
    }
    await until(() => frames.some(f => (f as WorkerDoneFrame).type === 'worker.done' && (f as WorkerDoneFrame).runId === runId))
    const dones = frames.filter(f => (f as WorkerDoneFrame).type === 'worker.done' && (f as WorkerDoneFrame).runId === runId) as WorkerDoneFrame[]
    expect(dones.length).toBe(1)
    expect(dones[0]!.status).toBe(expectStatus)
    const token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8') : undefined
    for (const f of frames) {
      expect(HelperFrame.safeParse(f).success).toBe(true)
      if (token) expect(JSON.stringify(f)).not.toContain(token)
    }
    expect(host.activeCount()).toBe(0)
    expect(readdirSync(join(dir, 'worker-runs'))).toEqual([])
    if (existsSync(proxyFile)) await expect(fetch(readFileSync(proxyFile, 'utf8'), { method: 'POST' })).rejects.toThrow()
    if (existsSync(pidFile)) {
      const childPid = Number(readFileSync(pidFile, 'utf8'))
      await until(() => !pidAlive(childPid))
      expect(pidAlive(childPid)).toBe(false)
    }
    host.handle({ type: 'worker.ack', runId })
  }
  db.close()
})

test('property (b): contender promotion over a real stale WebSocket delivers capabilities & unacked worker.done, and oversized worker.start fails without closing', async () => {
  const dir = tempDir()
  const db = openDatabase(join(dir, 'leader.db'))
  const store = new ComputerStore(db)
  const serverKey = loadServerKey(dir)
  const service = new ComputerService(
    store,
    serverKey,
    () => true,
    () => dir,
    undefined,
    () => 'full-access'
  )
  const pair = generateKeyPairSync('ed25519')
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const pubKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  store.add('remote', { name: 'Remote', os: 'linux', home: dir, capabilities: ['exec', 'read', 'write', 'list', 'copy'] }, pubKey)

  const seenFrames: WorkerHelperFrame[] = []
  const waitDone = (id: string) => until(() => seenFrames.some(f => f.type === 'worker.done' && f.runId === id))
  let activeSend: ((f: WorkerLeaderFrame) => boolean) | undefined
  const activeRuns = new Set(['unacked-1', 'oversized-1', 'ok-after-1'])
  const bridge: WorkerDoorBridge = {
    hasRun: (_c, r) => activeRuns.has(r),
    onConnect: (_c, send) => {
      activeSend = send
      return () => {
        activeSend = undefined
      }
    },
    onFrame: (_c, frame, send) => {
      seenFrames.push(frame)
      if (frame.type === 'worker.done') send({ type: 'worker.ack', runId: frame.runId })
    }
  }
  const door = startPublicDoor(service, 0, { workers: bridge })
  const identity = { id: 'remote', url: `http://127.0.0.1:${door.port}`, privateKey, serverFingerprint: serverKey.fingerprint }
  const staleWs = new WebSocket(`ws://127.0.0.1:${door.port}/helper/connect`, { headers: connectionHeaders(identity) } as any)
  await until(() => Boolean(activeSend))

  const helperDir = join(dir, 'helper')
  mkdirSync(helperDir, { recursive: true })
  const hdb = new Database(join(helperDir, 'requests.db'))
  prepareWorkerJournal(hdb)
  finishWorkerRecord(hdb, { type: 'worker.done', runId: 'unacked-1', sessionId: 'sess-prior', status: 'completed', text: 'survived drop', items: [] })
  hdb.close()

  const fakeAgent = writeScript(
    dir,
    'agent',
    `if (process.argv.includes('--version')) { console.log('2.1.327 (Claude Code)'); process.exit(0) }\nconsole.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's-after', result: 'socket stayed open' }))`
  )
  const ac = new AbortController()
  const runnerPromise = run(identity, ac.signal, { configDir: helperDir, drivers: [claudeCodeDriver({ bin: fakeAgent, configDir: helperDir })] })
  try {
    await Bun.sleep(3200)
    service.tick()
    await waitDone('unacked-1')
    await until(() => store.list().find(c => c.id === 'remote')?.workerAgents?.[0]?.version === '2.1.327')
    expect(seenFrames.filter(f => f.type === 'worker.done' && f.runId === 'unacked-1').length).toBe(1)

    expect(activeSend).toBeDefined()
    activeSend!({ type: 'worker.start', runId: 'oversized-1', cwd: dir, model: 'claude-sonnet-5-5', systemPrompt: 'x'.repeat(110_000), prompt: 'hi', mcpEnabled: false })
    await waitDone('oversized-1')
    expect(seenFrames.find(f => f.type === 'worker.done' && f.runId === 'oversized-1')).toMatchObject({ status: 'failed' })

    activeSend!({ type: 'worker.start', runId: 'ok-after-1', cwd: dir, model: 'claude-sonnet-5-5', prompt: 'hi', mcpEnabled: false })
    await waitDone('ok-after-1')
    expect(seenFrames.find(f => f.type === 'worker.done' && f.runId === 'ok-after-1')).toMatchObject({ status: 'completed', text: 'socket stayed open' })
  } finally {
    staleWs.close()
    ac.abort()
    await runnerPromise
    service.close()
    door.stop(true)
    db.close()
  }
})
