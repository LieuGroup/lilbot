import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeDriver } from '../../helper/drivers/claude-code/worker-driver-claude'
import { detectWorkerAgents } from '../../helper/worker-driver'
import { WorkerHost } from '../../helper/worker-host'
import type { WorkerDoneFrame, WorkerEventFrame, WorkerMcpRequestFrame, WorkerSteerResultFrame } from '../../shared/worker-frame-schema'
import { until } from '../helpers/until'
import { writeFakeClaude } from './worker-fake-agent'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(bin?: string, opts: { maxWorkers?: number; coalesceMs?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'worker-host-'))
  roots.push(root)
  const db = new Database(join(root, 'requests.db'))
  const frames: unknown[] = []
  const mcpCalls: WorkerMcpRequestFrame[] = []
  let online = true
  const driver = claudeCodeDriver({ bin: bin ?? writeFakeClaude(root), configDir: root, killGraceMs: 500 })
  const host = new WorkerHost({
    db,
    drivers: [driver],
    maxWorkers: opts.maxWorkers ?? 2,
    coalesceMs: opts.coalesceMs ?? 120,
    mcpRetryWindowMs: 2000,
    mcpRetryIntervalMs: 30,
    send: (_key, frame) => {
      if (online) frames.push(frame)
    },
    emitNow: frame => {
      if (!online) return false
      mcpCalls.push(frame as WorkerMcpRequestFrame)
      return true
    }
  })
  return { root, db, driver, host, frames, mcpCalls, setOnline: (v: boolean) => (online = v) }
}

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

test('detection advertises agent version when present and omits it cleanly when absent', async () => {
  const f = setup()
  expect(await detectWorkerAgents([f.driver])).toEqual([{ driver: 'claude-code', version: '2.1.327', supported: true }])
  const absent = claudeCodeDriver({ bin: join(f.root, 'does-not-exist'), configDir: f.root })
  expect(await detectWorkerAgents([absent])).toEqual([])

  const host = new WorkerHost({ db: f.db, drivers: [absent], send: (_k, fr) => f.frames.push(fr), emitNow: () => true })
  host.handle({ type: 'worker.start', runId: 'absent-1', cwd: f.root, model: 'claude-sonnet-5-5', prompt: '{"mode":"ok"}', mcpEnabled: false })
  await until(() => f.frames.some(fr => (fr as WorkerDoneFrame).type === 'worker.done'))
  expect(f.frames.find(fr => (fr as WorkerDoneFrame).type === 'worker.done')).toMatchObject({ status: 'failed', error: 'Claude Code is not installed on this computer.' })
  f.db.close()
})

test('streaming coalesces bursts, model refusal returns agent reason, and cap enforces max workers', async () => {
  const f = setup(undefined, { maxWorkers: 2, coalesceMs: 120 })
  f.host.handle({ type: 'worker.start', runId: 'burst-1', cwd: f.root, model: 'claude-sonnet-5-5', prompt: JSON.stringify({ mode: 'burst', burst: 20 }), mcpEnabled: false })
  await until(() => f.frames.some(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'burst-1'))
  const events = f.frames.filter(fr => (fr as WorkerEventFrame).type === 'worker.event')
  expect(events.length).toBeGreaterThanOrEqual(1)
  expect(events.length).toBeLessThan(10)
  const done = f.frames.find(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'burst-1') as WorkerDoneFrame
  expect(done).toMatchObject({ status: 'completed', sessionId: 'fake-session-1', text: 'burst-20-done', usage: { inputTokens: 10, outputTokens: 5 } })

  // Model refusals (both stream-json error result and stderr exit) surface the agent's plain reason.
  f.host.handle({ type: 'worker.start', runId: 'refuse-1', cwd: f.root, model: 'bad-model-x', prompt: JSON.stringify({ mode: 'refuse-model' }), mcpEnabled: false })
  f.host.handle({ type: 'worker.start', runId: 'refuse-2', cwd: f.root, model: 'bad-model-y', prompt: JSON.stringify({ mode: 'refuse-stderr' }), mcpEnabled: false })
  await until(() => f.frames.filter(fr => (fr as WorkerDoneFrame).type === 'worker.done').length === 3)
  expect(f.frames.find(fr => (fr as WorkerDoneFrame).runId === 'refuse-1' && (fr as WorkerDoneFrame).type === 'worker.done')).toMatchObject({
    status: 'failed',
    error: 'Model bad-model-x is not enabled for this account.'
  })
  expect(f.frames.find(fr => (fr as WorkerDoneFrame).runId === 'refuse-2' && (fr as WorkerDoneFrame).type === 'worker.done')).toMatchObject({
    status: 'failed',
    error: 'Error: unsupported model bad-model-y'
  })

  // Concurrency cap: 2 sleep workers fill capacity; 3rd fails immediately with capacity message.
  f.host.handle({ type: 'worker.start', runId: 'cap-1', cwd: f.root, model: 'claude-sonnet-5-5', prompt: JSON.stringify({ mode: 'sleep', waitMs: 5000 }), mcpEnabled: false })
  f.host.handle({ type: 'worker.start', runId: 'cap-2', cwd: f.root, model: 'claude-sonnet-5-5', prompt: JSON.stringify({ mode: 'sleep', waitMs: 5000 }), mcpEnabled: false })
  f.host.handle({ type: 'worker.start', runId: 'cap-3', cwd: f.root, model: 'claude-sonnet-5-5', prompt: JSON.stringify({ mode: 'ok' }), mcpEnabled: false })
  await until(() => f.frames.some(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'cap-3'))
  expect(f.frames.find(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'cap-3')).toMatchObject({
    status: 'failed',
    error: 'Worker capacity reached on this computer; try again later.'
  })
  f.host.stopAll()
  await until(() => f.host.activeCount() === 0)
  f.db.close()
})

test('steer reaches running agent, stop kills process group with no orphan, and MCP proxy handles round trip + auth + server/discover', async () => {
  const f = setup()
  f.host.handle({ type: 'worker.start', runId: 'steer-1', cwd: f.root, model: 'claude-sonnet-5-5', prompt: JSON.stringify({ mode: 'steer' }), mcpEnabled: false })
  await until(() => f.frames.some(fr => (fr as WorkerEventFrame).type === 'worker.event' && (fr as WorkerEventFrame).runId === 'steer-1'))
  f.host.handle({ type: 'worker.steer', runId: 'steer-1', steerId: 'st1', text: 'change focus now' })
  await until(() => f.frames.some(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'steer-1'))
  expect(f.frames.find(fr => (fr as WorkerSteerResultFrame).type === 'worker.steer.result')).toMatchObject({ runId: 'steer-1', steerId: 'st1', status: 'steered' })
  expect(f.frames.find(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'steer-1')).toMatchObject({
    status: 'completed',
    text: 'steered:change focus now'
  })

  // Stop kills both the agent and its child process group, and removes the temporary MCP config file.
  const childPidFile = join(f.root, 'child.pid')
  f.host.handle({ type: 'worker.start', runId: 'stop-1', cwd: f.root, model: 'claude-sonnet-5-5', prompt: JSON.stringify({ mode: 'sleep', childPidFile }), mcpEnabled: true })
  await until(() => existsSync(childPidFile))
  const childPid = Number(readFileSync(childPidFile, 'utf8').trim())
  expect(isAlive(childPid)).toBe(true)
  f.host.handle({ type: 'worker.stop', runId: 'stop-1' })
  await until(() => f.frames.some(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'stop-1'))
  expect(f.frames.find(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'stop-1')).toMatchObject({ status: 'stopped' })
  await until(() => !isAlive(childPid))
  expect(readdirSync(join(f.root, 'worker-runs'))).toEqual([])

  // MCP proxy round trip: server/discover answered locally, bad auth/origin refused, tools/call forwarded over frames.
  f.host.handle({ type: 'worker.start', runId: 'mcp-1', cwd: f.root, model: 'claude-sonnet-5-5', prompt: JSON.stringify({ mode: 'mcp' }), mcpEnabled: true })
  await until(() => f.mcpCalls.length === 1)
  const req = f.mcpCalls[0]
  expect(req.runId).toBe('mcp-1')
  expect(JSON.parse(req.body)).toMatchObject({ method: 'tools/call', params: { name: 'lilbot_work' } })
  f.host.handle({
    type: 'worker.mcp.response',
    runId: 'mcp-1',
    callId: req.callId,
    status: 200,
    body: JSON.stringify({ jsonrpc: '2.0', id: 4, result: { content: [{ type: 'text', text: '{"ok":true}' }] } })
  })
  await until(() => f.frames.some(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'mcp-1'))
  const mcpDone = f.frames.find(fr => (fr as WorkerDoneFrame).type === 'worker.done' && (fr as WorkerDoneFrame).runId === 'mcp-1') as WorkerDoneFrame
  expect(JSON.parse(mcpDone.text)).toEqual({
    discStatus: 200,
    badAuth: 403,
    badOrigin: 403,
    callStatus: 200,
    callResult: { content: [{ type: 'text', text: '{"ok":true}' }] }
  })
  expect(readdirSync(join(f.root, 'worker-runs'))).toEqual([])
  f.db.close()
})
