import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveClaudeBinary } from '../../helper/drivers/claude-code/worker-claude-env'
import { buildClaudeArgs, createClaudeStreamState, parseClaudeLine } from '../../helper/drivers/claude-code/worker-claude-protocol'
import { claudeCodeDriver } from '../../helper/drivers/claude-code/worker-driver-claude'
import { createAgentProbe, type WorkerDriver } from '../../helper/worker-driver'
import { WorkerHost } from '../../helper/worker-host'
import { boundWorkerDone, unacknowledgedWorkers } from '../../helper/worker-journal'
import { HelperFrame } from '../../shared/computer-schema'
import { type WorkerDoneFrame, WorkerStartFrame } from '../../shared/worker-frame-schema'
import { until } from '../helpers/until'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'worker-hardening-'))
  roots.push(dir)
  return dir
}
const writeScript = (dir: string, name: string, body: string) => {
  const path = join(dir, name)
  writeFileSync(path, `#!/usr/bin/env bun\n${body}\n`, { mode: 0o700 })
  return path
}
const makeHost = (db: Database, dir: string, driver: WorkerDriver, frames: unknown[]) =>
  new WorkerHost({ db, configDir: dir, drivers: [driver], coalesceMs: 10, send: (_k, f) => frames.push(f), emitNow: () => true })
const findDone = (frames: unknown[], runId: string) =>
  frames.find(f => (f as WorkerDoneFrame).type === 'worker.done' && (f as WorkerDoneFrame).runId === runId) as WorkerDoneFrame | undefined

test('F1/F2/F4/F5: hostile stdout (null, control tool ids, token in session_id, huge lines, endless text/tools) never crashes, leaks secrets, or violates schemas', async () => {
  const dir = tempDir()
  const secret = 'secret-bearer-token-abcdef123456'
  const state = createClaudeStreamState()
  expect(parseClaudeLine('null', state, secret)).toBeNull()
  expect(parseClaudeLine('[1,2]', state, secret)).toBeNull()
  expect(
    parseClaudeLine('{"type":"assistant","message":{"content":[null,42,{"type":"tool_use","id":"\\u0000","name":"\\u0007"},{"type":"text","text":"safe"}]}}', state, secret)
  ).toMatchObject({
    textPreview: 'safe'
  })
  // F2: bearer token or leading-dash session_id is rejected.
  expect(parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: secret }), state, secret)?.sessionId).toBeUndefined()
  expect(parseClaudeLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: '--evil-flag' }), state, secret)?.sessionId).toBeUndefined()
  expect(state.sessionId).toBeUndefined()

  // F5: tools cap at 500, text caps at 500k, and boundWorkerDone keeps frames under 1 MiB.
  const capState = createClaudeStreamState()
  for (let i = 0; i < 600; i++) {
    parseClaudeLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `id-${i}`, name: 'Bash', input: { command: 'x' } }] } }), capState)
  }
  expect(capState.tools.size).toBe(500)
  expect(capState.items.length).toBe(500)
  for (let i = 0; i < 10; i++) parseClaudeLine(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a'.repeat(90_000) }] } }), capState)
  expect(capState.text.length).toBeLessThanOrEqual(500_000)
  const bounded = boundWorkerDone({
    type: 'worker.done',
    runId: 'big',
    status: 'completed',
    text: 't'.repeat(400_000),
    items: Array.from({ length: 500 }, (_, i) => ({ kind: 'tool' as const, toolId: `t${i}`, name: 'Bash', detail: 'd', result: 'r'.repeat(2000), running: false }))
  })
  expect(Buffer.byteLength(JSON.stringify(bounded))).toBeLessThanOrEqual(900_000)

  // End-to-end hostile agent: emits null, leaked token session_id, control-only tool_use, >2MiB line without \n, then valid result.
  const agent = writeScript(
    dir,
    'hostile-agent',
    `import { readFileSync } from 'node:fs'
const args = process.argv.slice(2)
const mcpPath = args[args.indexOf('--mcp-config') + 1]
const token = JSON.parse(readFileSync(mcpPath, 'utf8')).mcpServers.lilbot_system.headers.Authorization.slice(7)
process.stdout.write('null\\n')
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init', session_id: token }) + '\\n')
process.stdout.write(JSON.stringify({ type: 'assistant', message: { content: [null, { type: 'tool_use', id: '\\u0000', name: 'Bad' }] } }) + '\\n')
process.stdout.write('x'.repeat(2_200_000) + '\\n')
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 'good-sess-1', result: 'done ' + token }) + '\\n')`
  )
  const db = new Database(join(dir, 'requests.db'))
  const frames: unknown[] = []
  const host = makeHost(db, dir, claudeCodeDriver({ bin: agent, configDir: dir }), frames)
  host.handle({ type: 'worker.start', runId: 'hostile-1', cwd: dir, model: 'claude-sonnet-5-5', prompt: 'go', mcpEnabled: true })
  await until(() => Boolean(findDone(frames, 'hostile-1')))
  for (const frame of frames) expect(HelperFrame.safeParse(frame).success).toBe(true)
  expect(findDone(frames, 'hostile-1')).toMatchObject({ status: 'completed', sessionId: 'good-sess-1', text: 'done [redacted]' })
  expect(host.activeCount()).toBe(0)
  db.close()
})

test('F3/F9/F11/F12 & drain timeout: throwing start leaks nothing, stale configs wiped, 0-exit without result fails, journal capped at 32, grandchild cannot hang slot', async () => {
  const dir = tempDir()
  expect(WorkerStartFrame.safeParse({ type: 'worker.start', runId: 'r', cwd: dir, model: 'claude-sonnet-5-5', systemPrompt: 'a'.repeat(100_000), prompt: 'hi' }).success).toBe(
    false
  )
  expect(WorkerStartFrame.safeParse({ type: 'worker.start', runId: 'r', cwd: dir, model: '-bad', prompt: 'hi' }).success).toBe(false)
  expect(WorkerStartFrame.safeParse({ type: 'worker.start', runId: 'r', cwd: dir, model: 'm', sessionId: '-flag', prompt: 'hi' }).success).toBe(false)
  expect(() => buildClaudeArgs({ runId: 'r', cwd: dir, model: 'm', systemPrompt: 'a'.repeat(100_000), prompt: 'hi' }, '/tmp/x')).toThrow()

  mkdirSync(join(dir, 'worker-runs'), { recursive: true, mode: 0o755 })
  writeFileSync(join(dir, 'worker-runs', 'stale.mcp.json'), '{}')
  const db = new Database(join(dir, 'requests.db'))
  const frames: unknown[] = []
  let cleanupDir: string | undefined
  let leakedProxyUrl = ''
  const throwingDriver: WorkerDriver = {
    id: 'claude-code',
    detect: async () => ({ driver: 'claude-code', version: '1.0' }),
    cleanupStale: configDir => {
      cleanupDir = configDir
    },
    start: req => {
      leakedProxyUrl = req.mcp?.url ?? ''
      throw new Error('E2BIG boom')
    }
  }
  const host = makeHost(db, dir, throwingDriver, frames)
  expect(cleanupDir).toBe(dir)
  expect(existsSync(join(dir, 'worker-runs', 'stale.mcp.json'))).toBe(true)

  host.handle({ type: 'worker.start', runId: 'throw-1', cwd: dir, model: 'claude-sonnet-5-5', prompt: 'hi', mcpEnabled: true })
  expect(host.activeCount()).toBe(0)
  expect(findDone(frames, 'throw-1')).toMatchObject({ status: 'failed', error: 'Failed to start worker.' })
  await expect(fetch(leakedProxyUrl, { method: 'POST' })).rejects.toThrow()

  const silentExit = writeScript(dir, 'silent-exit', 'process.exit(0)')
  const host2 = makeHost(db, dir, claudeCodeDriver({ bin: silentExit, configDir: dir }), frames)
  expect(existsSync(join(dir, 'worker-runs', 'stale.mcp.json'))).toBe(false)
  expect(statSync(join(dir, 'worker-runs')).mode & 0o777).toBe(0o700)
  host2.handle({ type: 'worker.start', runId: 'silent-1', cwd: dir, model: 'claude-sonnet-5-5', prompt: 'hi', mcpEnabled: false })
  await until(() => Boolean(findDone(frames, 'silent-1')))
  expect(findDone(frames, 'silent-1')).toMatchObject({ status: 'failed', error: 'Worker exited without a final result.' })

  const leaky = writeScript(
    dir,
    'leaky',
    `process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, session_id: 's1', result: 'fast' }) + '\\n')
Bun.spawn(['setsid', 'sleep', '5'], { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' })
process.exit(0)`
  )
  const host3 = makeHost(db, dir, claudeCodeDriver({ bin: leaky, configDir: dir, drainTimeoutMs: 150 }), frames)
  const t0 = Date.now()
  host3.handle({ type: 'worker.start', runId: 'drain-1', cwd: dir, model: 'claude-sonnet-5-5', prompt: 'hi', mcpEnabled: false })
  await until(() => Boolean(findDone(frames, 'drain-1')))
  expect(Date.now() - t0).toBeLessThan(1500)
  expect(findDone(frames, 'drain-1')).toMatchObject({ status: 'completed', text: 'fast' })

  for (let i = 0; i < 36; i++) {
    host.handle({ type: 'worker.start', runId: `cap-j-${i}`, cwd: dir, model: 'claude-sonnet-5-5', prompt: 'hi', mcpEnabled: false })
    host.handle({ type: 'worker.stop', runId: `unknown-stop-${i}` })
  }
  expect(unacknowledgedWorkers(db).length).toBeLessThanOrEqual(32)

  // Corrupt stored JSON does not crash WorkerHost on reconnect.
  db.query('INSERT INTO worker_runs(run_id, done_frame, finished_at) VALUES(?,?,?)').run('corrupt-1', '{bad-json', Date.now())
  expect(() => host.onReconnect()).not.toThrow()

  const symRoot = tempDir()
  symlinkSync(dir, join(symRoot, 'worker-runs'))
  const symOutcome = await claudeCodeDriver({ bin: silentExit, configDir: symRoot }).start({ runId: 'sym-1', cwd: dir, model: 'm', prompt: 'hi' }, () => {}).done
  expect(symOutcome).toMatchObject({ status: 'failed', error: 'Worker config directory cannot be a symlink.' })
  expect(readdirSync(join(dir, 'worker-runs'))).toEqual([])
  db.close()
})

test('F8: version strips format/control chars, capability probe caches across reconnects, and PATH skips world-writable dirs', async () => {
  const dir = tempDir()
  const badVer = writeScript(dir, 'bad-ver', "console.log('2.1\\u200b327\\u0085 (Claude Code)')")
  const info = await claudeCodeDriver({ bin: badVer, configDir: dir }).detect()
  expect(info).toEqual({ driver: 'claude-code', version: '2.1327', supported: true })
  expect(HelperFrame.safeParse({ type: 'worker.capabilities', agents: [info!] }).success).toBe(true)

  let calls = 0
  const counting: WorkerDriver = {
    id: 'claude-code',
    detect: async () => {
      calls++
      return { driver: 'claude-code', version: '1.0' }
    },
    start: () => {
      throw new Error('unused')
    }
  }
  const probe = await createAgentProbe([counting], () => {}, 60_000)
  probe.refresh()
  probe.refresh()
  expect(calls).toBe(1)

  const worldDir = join(dir, 'world-bin')
  mkdirSync(worldDir)
  chmodSync(worldDir, 0o777)
  writeScript(worldDir, 'claude', "console.log('9.9.9')")
  expect(resolveClaudeBinary(undefined, `${worldDir}:.`)).not.toBe(join(worldDir, 'claude'))
})
