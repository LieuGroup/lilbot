import { afterEach, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from '../../helper/runner'
import { claudeCodeDriver } from '../../helper/worker-driver-claude'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { loadServerKey } from '../../server/computers/server-key'
import type { WorkerDoorBridge } from '../../server/computers/worker-door'
import { openDatabase } from '../../server/database/database'
import { startPublicDoor } from '../../server/http/public-door'
import type { WorkerDoneFrame, WorkerHelperFrame, WorkerLeaderFrame } from '../../shared/worker-frame-schema'
import { until } from '../helpers/until'
import { writeFakeClaude } from './worker-fake-agent'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

function harness(agentPresent = true) {
  const root = mkdtempSync(join(tmpdir(), 'worker-e2e-'))
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
  const computerId = 'worker-box'
  store.add(
    computerId,
    { name: 'Worker Box', os: 'linux', home: root, capabilities: ['exec', 'read', 'write', 'list', 'copy'] },
    pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  )

  const allowedRuns = new Set<string>()
  const received: WorkerHelperFrame[] = []
  let sendToHelper: ((frame: WorkerLeaderFrame) => boolean) | undefined
  let retired = false

  const bridge: WorkerDoorBridge = {
    hasRun: (cid, runId) => cid === computerId && allowedRuns.has(runId),
    onConnect: (cid, send) => {
      if (cid === computerId) sendToHelper = send
      return () => {
        if (cid === computerId) sendToHelper = undefined
      }
    },
    onFrame: (_cid, frame, send) => {
      received.push(frame)
      if (frame.type === 'worker.mcp.request') {
        const rpc = JSON.parse(frame.body) as { id: unknown }
        send({ type: 'worker.mcp.response', runId: frame.runId, callId: frame.callId, status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { ok: true } }) })
      }
    }
  }
  const door = startPublicDoor(service, 0, { workers: bridge })
  const driver = claudeCodeDriver({ bin: agentPresent ? writeFakeClaude(root) : join(root, 'no-agent'), configDir: root, killGraceMs: 400 })
  const controller = new AbortController()
  const runner = run(
    {
      id: computerId,
      url: `http://127.0.0.1:${door.port}`,
      privateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      serverFingerprint: serverKey.fingerprint
    },
    controller.signal,
    {
      configDir: root,
      drivers: [driver],
      coalesceMs: 100,
      retire: async () => {
        retired = true
      }
    }
  )

  cleanups.push(async () => {
    controller.abort()
    await runner
    door.stop(true)
    service.close()
    db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, service, store, door, computerId, allowedRuns, received, getSend: () => sendToHelper, isRetired: () => retired, runner }
}

test('helper advertises worker capability only when an agent exists; absent agent stays usable for commands', async () => {
  const withAgent = harness(true)
  await until(
    () =>
      withAgent.service
        .list()
        .find(c => c.id === withAgent.computerId)
        ?.capabilities.includes('worker') === true
  )
  expect(withAgent.service.list().find(c => c.id === withAgent.computerId)?.workerAgents).toEqual([{ driver: 'claude-code', version: '2.1.327' }])

  const withoutAgent = harness(false)
  await until(() => withoutAgent.service.list().find(c => c.id === withoutAgent.computerId)?.online === true)
  await Bun.sleep(150)
  const plain = withoutAgent.service.list().find(c => c.id === withoutAgent.computerId)!
  expect(plain.capabilities).not.toContain('worker')
  expect(plain.workerAgents).toBeUndefined()
  const cmd = await withoutAgent.service.submit('b1', { computer: withoutAgent.computerId, requestId: 'cmd-1', operation: { kind: 'exec', command: 'printf STILL_WORKS' } })
  expect(cmd).toMatchObject({ status: 'completed', result: { output: 'STILL_WORKS' } })
})

test('MCP proxy works over signed WebSocket, unstarted runIds are refused, and disconnect/reconnect never spawns twice', async () => {
  const f = harness()
  await until(() => Boolean(f.getSend()))

  // Unstarted runId: leader door refuses all helper frames for runs it did not start on that computer.
  f.getSend()!({ type: 'worker.start', runId: 'untracked-run', cwd: f.root, model: 'claude-sonnet-5-5', prompt: '{"mode":"ok"}', mcpEnabled: false })
  await Bun.sleep(300)
  expect(f.received.some(fr => 'runId' in fr && fr.runId === 'untracked-run')).toBe(false)

  // Authorized MCP round-trip over the signed socket.
  f.allowedRuns.add('mcp-run')
  f.getSend()!({ type: 'worker.start', runId: 'mcp-run', cwd: f.root, model: 'claude-sonnet-5-5', prompt: '{"mode":"mcp"}', mcpEnabled: true })
  await until(() => f.received.some(fr => fr.type === 'worker.done' && fr.runId === 'mcp-run'))
  const mcpDone = f.received.find(fr => fr.type === 'worker.done' && fr.runId === 'mcp-run') as WorkerDoneFrame
  expect(JSON.parse(mcpDone.text)).toMatchObject({ discStatus: 200, badAuth: 403, badOrigin: 403, callStatus: 200, callResult: { ok: true } })
  f.getSend()!({ type: 'worker.ack', runId: 'mcp-run' })

  // Drop connection mid-run, restart door on same port, re-send worker.start: helper finishes without a second spawn.
  const spawnLog = join(f.root, 'spawns.log')
  const startFrame: WorkerLeaderFrame = {
    type: 'worker.start',
    runId: 'reconnect-run',
    cwd: f.root,
    model: 'claude-sonnet-5-5',
    prompt: JSON.stringify({ mode: 'sleep', waitMs: 900, spawnLog }),
    mcpEnabled: false
  }
  f.allowedRuns.add('reconnect-run')
  f.getSend()!(startFrame)
  await until(() => existsSync(spawnLog))
  const port = f.door.port!
  f.service.close()
  f.door.stop(true)
  await until(() => !f.getSend())

  const service2 = new ComputerService(
    f.store,
    loadServerKey(f.root),
    () => true,
    () => f.root,
    () => {},
    () => 'full-access'
  )
  let send2: ((frame: WorkerLeaderFrame) => boolean) | undefined
  const doneAfter: WorkerDoneFrame[] = []
  const door2 = startPublicDoor(service2, port, {
    workers: {
      hasRun: (cid, runId) => cid === f.computerId && runId === 'reconnect-run',
      onConnect: (_cid, send) => {
        send2 = send
        return () => (send2 = undefined)
      },
      onFrame: (_cid, frame, send) => {
        if (frame.type === 'worker.done') {
          doneAfter.push(frame)
          send({ type: 'worker.ack', runId: frame.runId })
        }
      }
    }
  })
  cleanups.push(() => {
    door2.stop(true)
    service2.close()
  })
  await until(() => Boolean(send2), 5000)
  send2!(startFrame)
  await until(() => doneAfter.length === 1, 5000)
  expect(doneAfter[0]).toMatchObject({ runId: 'reconnect-run', status: 'completed', text: 'slept' })
  expect(readFileSync(spawnLog, 'utf8').trim().split('\n')).toHaveLength(1)
}, 15_000)

test('signed revocation mid-run stops running worker and its child process group and retires helper', async () => {
  const f = harness()
  await until(() => Boolean(f.getSend()))
  const childPidFile = join(f.root, 'revoked-child.pid')
  f.allowedRuns.add('revoke-run')
  f.getSend()!({ type: 'worker.start', runId: 'revoke-run', cwd: f.root, model: 'claude-sonnet-5-5', prompt: JSON.stringify({ mode: 'sleep', childPidFile }), mcpEnabled: true })
  await until(() => existsSync(childPidFile))
  const childPid = Number(readFileSync(childPidFile, 'utf8').trim())

  f.service.remove(f.computerId)
  await f.runner
  expect(f.isRetired()).toBe(true)
  await until(() => {
    try {
      process.kill(childPid, 0)
      return false
    } catch {
      return true
    }
  })
}, 10_000)
