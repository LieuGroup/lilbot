/** State-machine matrix for `RemoteWorkerRunner` across every run state (starting, running, stopping, offline,
 *  restored after restart, settled) + direct regression tests for escaped sabotages S6b, S8, S9 and PR #234 fixes. */
import { afterEach, expect, test } from 'bun:test'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ComputerService } from '../../server/computers/computer-service'
import { ComputerStore } from '../../server/computers/computer-store'
import { RemoteWorkerRunner } from '../../server/computers/remote-worker-runner'
import { sanitizeWorkerDone } from '../../server/computers/remote-worker-sanitize'
import { loadServerKey } from '../../server/computers/server-key'
import { createWorkerSocketState, handleOversizedWorkerDone, handleWorkerFrame } from '../../server/computers/worker-door'
import { openDatabase } from '../../server/database/database'
import { WORKER_DONE_MAX_BYTES, WORKER_SYSTEM_PROMPT_MAX_BYTES, type WorkerLeaderFrame } from '../../shared/worker-frame-schema'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const collector = (out: WorkerLeaderFrame[]) => (f: WorkerLeaderFrame) => {
  out.push(f)
  return true
}

function setup(opts: Partial<ConstructorParameters<typeof RemoteWorkerRunner>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rw-states-'))
  const db = openDatabase(join(dir, 'lilbot.db'))
  const sent: { cid: string; frame: WorkerLeaderFrame }[] = []
  let mcpCalls = 0
  const events: string[] = []
  const runner = new RemoteWorkerRunner({
    db,
    botExists: () => true,
    handleMcp: async (_ctx, body) => {
      mcpCalls++
      const id = (JSON.parse(body) as { id?: unknown }).id ?? null
      return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id, result: { ok: true } }) }
    },
    offlineGraceMs: 250,
    stopGraceMs: 200,
    steerTimeoutMs: 120,
    ...opts
  })
  runner.onToolCall(ev => events.push(ev.activity))
  cleanups.push(() => {
    runner.close()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
  const sendTo = (cid: string) => (frame: WorkerLeaderFrame) => {
    sent.push({ cid, frame })
    return true
  }
  const connect = (cid: string) => runner.bridge.onConnect!(cid, sendTo(cid))
  const input = (runId: string, extra: Partial<Parameters<RemoteWorkerRunner['run']>[0]> = {}) => ({
    runId,
    computerId: 'c1',
    botId: 'b1',
    threadId: `t-${runId}`,
    chatId: `remote:t-${runId}`,
    cwd: '/tmp/app',
    model: 'claude-sonnet-5-5',
    systemPrompt: 'sys',
    prompt: 'go',
    ...extra
  })
  return { dir, db, runner, sent, events, sendTo, connect, input, mcpCalls: () => mcpCalls }
}

test('state matrix: starting, running (with S8 maxPerComputer=2), stopping (High #2), settled (S6b + S9 + Low #9/#10)', async () => {
  const f = setup()
  const sock = createWorkerSocketState()

  // STARTING (peer not connected yet): queues pendingStart, rejects steer, ignores wrong-computer frame via handleWorkerFrame (S6b).
  const pStart = f.runner.run(f.input('r-start'))
  expect(f.runner.bridge.hasRun('c1', 'r-start')).toBe(true)
  expect(f.runner.bridge.hasRun('c2', 'r-start')).toBe(false)
  expect(await f.runner.steer('c1', 'r-start', 'early')).toBe('not_running')
  const wrongOut: WorkerLeaderFrame[] = []
  handleWorkerFrame(
    f.db,
    'c2',
    { type: 'worker.done', runId: 'r-start', status: 'completed', text: 'hijack', items: [] },
    sock,
    Date.now(),
    64,
    collector(wrongOut),
    f.runner.bridge
  )
  handleOversizedWorkerDone('c2', { type: 'worker.done', runId: 'r-start' }, WORKER_DONE_MAX_BYTES + 1, sock, collector(wrongOut), f.runner.bridge)
  expect(wrongOut).toEqual([])
  expect(f.runner.bridge.hasRun('c1', 'r-start')).toBe(true)

  // Peer connects -> RUNNING: sends pendingStart; 2nd run starts; 3rd run directly on RemoteWorkerRunner hits maxPerComputer=2 (S8).
  const disconnect = f.connect('c1')
  expect(f.sent.some(s => s.frame.type === 'worker.start' && s.frame.runId === 'r-start')).toBe(true)
  const pRun2 = f.runner.run(f.input('r-2'))
  const overCap = await f.runner.run(f.input('r-3'))
  expect(overCap).toMatchObject({ status: 'failed', text: 'Worker capacity reached on this computer.' })
  expect(f.runner.activeForComputer('c1')).toBe(2)

  // STOPPING (High #2): MCP refused 409 without calling handleMcp; event/steer ignored; worker.done{completed} forced to 'stopped'!
  const beforeMcp = f.mcpCalls()
  const beforeEvents = f.events.length
  expect(await f.runner.stop('c1', 'r-start')).toBe(true)
  expect(await f.runner.steer('c1', 'r-start', 'late-steer')).toBe('not_running')
  f.runner.bridge.onFrame('c1', { type: 'worker.event', runId: 'r-start', tools: [{ toolId: 't1', name: 'Bash', detail: 'x', running: true }] }, f.sendTo('c1'))
  expect(f.events.length).toBe(beforeEvents)
  f.runner.bridge.onFrame('c1', { type: 'worker.mcp.request', runId: 'r-start', callId: 'stop-mcp', body: '{"jsonrpc":"2.0","id":7,"method":"tools/call"}' }, f.sendTo('c1'))
  expect(f.mcpCalls()).toBe(beforeMcp)
  expect(f.sent.some(s => s.frame.type === 'worker.mcp.response' && s.frame.callId === 'stop-mcp' && s.frame.status === 409)).toBe(true)
  f.runner.bridge.onFrame('c1', { type: 'worker.done', runId: 'r-start', status: 'completed', text: 'forged', items: [] }, f.sendTo('c1'))
  expect((await pStart).status).toBe('stopped')
  expect(f.runner.store.get('r-start')?.outcome?.status).toBe('stopped')

  // SETTLED: store.settle() twice returns false (S9); late event/MCP ignored; duplicate done gets 1 ack; wrong computer gets 0.
  expect(f.runner.store.settle('r-start', { status: 'completed', text: 'overwrite', items: [] })).toBe(false)
  expect(f.runner.store.get('r-start')?.outcome?.status).toBe('stopped')
  const settledOut: WorkerLeaderFrame[] = []
  handleWorkerFrame(f.db, 'c1', { type: 'worker.event', runId: 'r-start', activity: 'Working' }, sock, Date.now(), 64, collector(settledOut), f.runner.bridge)
  handleWorkerFrame(f.db, 'c1', { type: 'worker.mcp.request', runId: 'r-start', callId: 'late-m', body: '{}' }, sock, Date.now(), 64, collector(settledOut), f.runner.bridge)
  expect(settledOut).toEqual([])
  expect(f.mcpCalls()).toBe(beforeMcp)
  handleWorkerFrame(
    f.db,
    'c1',
    { type: 'worker.done', runId: 'r-start', status: 'completed', text: 'dup', items: [] },
    sock,
    Date.now(),
    64,
    collector(settledOut),
    f.runner.bridge
  )
  expect(settledOut).toEqual([{ type: 'worker.ack', runId: 'r-start' }])

  // Low #10: oversized worker.done emits exactly ONE worker.ack (not two).
  const overAcks: WorkerLeaderFrame[] = []
  handleOversizedWorkerDone('c1', { type: 'worker.done', runId: 'r-2' }, WORKER_DONE_MAX_BYTES + 1, sock, collector(overAcks), f.runner.bridge)
  expect(overAcks).toEqual([{ type: 'worker.ack', runId: 'r-2' }])
  expect((await pRun2).status).toBe('failed')

  // Low #9: sanitizeWorkerDone caps at 500 items even when 500 tool items + non-empty text arrive.
  const tools500 = Array.from({ length: 500 }, (_, i) => ({ kind: 'tool' as const, toolId: `t${i}`, name: 'Bash', detail: 'ok', running: false }))
  const capped = sanitizeWorkerDone({ type: 'worker.done', runId: 'x', status: 'completed', text: 'final answer', items: tools500 })!
  expect(capped.items).toHaveLength(500)
  expect(capped.items.at(-1)).toEqual({ kind: 'assistant', text: 'final answer' })
  disconnect()
})

test('offline revocation via ComputerService.remove (High #3) and restored run validation failure (Medium #6)', async () => {
  const f = setup({ offlineGraceMs: 60_000 })
  const compStore = new ComputerStore(f.db)
  const computers = new ComputerService(
    compStore,
    loadServerKey(f.dir),
    () => true,
    () => f.dir
  )
  const pair = generateKeyPairSync('ed25519')
  compStore.add('c-off', { name: 'OfflineBox', os: 'darwin', home: f.dir, capabilities: ['exec', 'worker'] }, pair.publicKey.export({ type: 'spki', format: 'pem' }).toString())
  computers.onRevoke = id => f.runner.onRevoke(id)
  cleanups.push(() => computers.close())

  // OFFLINE + High #3: disconnect arms offline grace (steer returns not_running); ComputerService.remove settles immediately.
  const disconnect = f.connect('c-off')
  const runP = f.runner.run(f.input('off-rev', { computerId: 'c-off' }))
  disconnect()
  expect(await f.runner.steer('c-off', 'off-rev', 'while-offline')).toBe('not_running')
  expect(f.runner.activeForComputer('c-off')).toBe(1)
  computers.remove('c-off')
  expect(await runP).toMatchObject({ status: 'failed', failureReason: 'computer_removed' })
  expect(f.runner.activeForComputer('c-off')).toBe(0)
  expect(f.runner.bridge.hasRun('c-off', 'off-rev')).toBe(false)
  expect(f.runner.store.get('off-rev')?.status).toBe('settled')

  // RESTORED + Medium #6: restart restores a running row; re-validation failure settles cleanly without leaking a slot.
  f.runner.store.insert({ runId: 'orphan-1', computerId: 'c-other', botId: 'b1', threadId: 't2', chatId: 'remote:t2' })
  const restarted = new RemoteWorkerRunner({ db: f.db, botExists: () => true, handleMcp: async () => ({ status: 200, body: '{}' }), offlineGraceMs: 60_000 })
  cleanups.push(() => restarted.close())
  expect(restarted.activeForComputer('c-other')).toBe(1)
  const failRes = await restarted.run(f.input('orphan-1', { computerId: 'c-other', systemPrompt: 'x'.repeat(WORKER_SYSTEM_PROMPT_MAX_BYTES + 100) }))
  expect(failRes).toMatchObject({ status: 'failed', failureReason: 'prompt_too_large' })
  expect(restarted.activeForComputer('c-other')).toBe(0)
  expect(restarted.bridge.hasRun('c-other', 'orphan-1')).toBe(false)
  expect(restarted.store.get('orphan-1')?.status).toBe('settled')
})
