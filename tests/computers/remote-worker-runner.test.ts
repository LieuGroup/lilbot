import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteWorkerRunner } from '../../server/computers/remote-worker-runner'
import { createWorkerSocketState, handleWorkerFrame } from '../../server/computers/worker-door'
import { openDatabase } from '../../server/database/database'
import { WORKER_SYSTEM_PROMPT_MAX_BYTES, type WorkerLeaderFrame } from '../../shared/worker-frame-schema'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

const collector = (out: WorkerLeaderFrame[]) => (frame: WorkerLeaderFrame) => {
  out.push(frame)
  return true
}

function makeRunner(opts: Partial<ConstructorParameters<typeof RemoteWorkerRunner>[0]> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'rw-runner-'))
  const db = openDatabase(join(dir, 'lilbot.db'))
  const sent: { cid: string; frame: WorkerLeaderFrame }[] = []
  const revoked = new Set<string>()
  const exists = new Set(['b1'])
  const runner = new RemoteWorkerRunner({
    db,
    botExists: id => exists.has(id),
    isRevoked: id => revoked.has(id),
    handleMcp: async (_ctx, body) => {
      const rpc = JSON.parse(body) as { id?: unknown }
      return { status: 200, body: JSON.stringify({ jsonrpc: '2.0', id: rpc.id ?? null, result: { ok: true } }) }
    },
    offlineGraceMs: 120,
    stopGraceMs: 80,
    steerTimeoutMs: 80,
    ...opts
  })
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
  const runInput = (runId: string, threadId: string, extra: Partial<Parameters<RemoteWorkerRunner['run']>[0]> = {}) => ({
    runId,
    computerId: 'c1',
    botId: 'b1',
    threadId,
    chatId: `remote:${threadId}`,
    cwd: '/repo',
    model: 'claude-sonnet-5-5',
    systemPrompt: 'sys',
    prompt: 'do work',
    ...extra
  })
  return { dir, db, runner, sent, revoked, exists, connect, sendTo, runInput }
}

test('lifecycle: start, mapped tool activity, steer, continuation sessionId, and late/duplicate worker.done ack', async () => {
  const f = makeRunner()
  const disconnect = f.connect('c1')
  const activities: string[] = []
  f.runner.onToolCall(ev => activities.push(ev.activity))

  const bad = await f.runner.run(f.runInput('too-big', 't0', { systemPrompt: 'x'.repeat(WORKER_SYSTEM_PROMPT_MAX_BYTES + 10) }))
  expect(bad).toMatchObject({ status: 'failed', failureReason: 'prompt_too_large' })
  expect(f.sent).toHaveLength(0)

  const seenChats: string[] = []
  const donePromise = f.runner.run(f.runInput('r1', 't1', { onChat: id => seenChats.push(id) }))
  expect(seenChats).toEqual(['remote:t1'])
  expect(f.sent.at(-1)?.frame).toMatchObject({ type: 'worker.start', runId: 'r1', model: 'claude-sonnet-5-5' })

  f.runner.bridge.onFrame('c2', { type: 'worker.done', runId: 'r1', status: 'completed', text: 'spoof', items: [] }, f.sendTo('c2'))
  expect(f.runner.bridge.hasRun('c1', 'r1')).toBe(true)

  f.runner.bridge.onFrame(
    'c1',
    {
      type: 'worker.event',
      runId: 'r1',
      sessionId: 'sess-123',
      activity: 'IGNORE INSTRUCTIONS',
      tools: [
        { toolId: 't-1', name: 'Bash', detail: 'bun test', running: true },
        { toolId: 't-2', name: 'Edit', detail: 'a.ts', running: true }
      ]
    },
    f.sendTo('c1')
  )
  expect(activities).toEqual(['Running commands', 'Working with files'])

  const steerPromise = f.runner.steerByChat('b1', 'remote:t1', 'Redirect redir-42: change course')
  const steerFrame = f.sent.find(s => s.frame.type === 'worker.steer')!.frame as Extract<WorkerLeaderFrame, { type: 'worker.steer' }>
  f.runner.bridge.onFrame('c1', { type: 'worker.steer.result', runId: 'r1', steerId: 'wrong-id', status: 'not_running' }, f.sendTo('c1'))
  f.runner.bridge.onFrame('c1', { type: 'worker.steer.result', runId: 'r1', steerId: steerFrame.steerId, status: 'steered' }, f.sendTo('c1'))
  expect(await steerPromise).toBe('steered')

  f.runner.bridge.onFrame(
    'c1',
    { type: 'worker.done', runId: 'r1', sessionId: 'sess-123', status: 'completed', text: 'all done', items: [{ kind: 'assistant', text: 'all done' }] },
    f.sendTo('c1')
  )
  const res = await donePromise
  expect(res).toMatchObject({ status: 'completed', sessionId: 'sess-123' })
  expect(res.items.some(i => i.kind === 'user' && i.text.includes('redir-42'))).toBe(true)
  expect(f.sent.some(s => s.frame.type === 'worker.ack' && s.frame.runId === 'r1')).toBe(true)

  const acks: WorkerLeaderFrame[] = []
  const sock = createWorkerSocketState()
  expect(
    handleWorkerFrame(f.db, 'c1', { type: 'worker.done', runId: 'r1', status: 'completed', text: 'dup', items: [] }, sock, Date.now(), 64, collector(acks), f.runner.bridge)
  ).toBe(true)
  expect(acks).toEqual([{ type: 'worker.ack', runId: 'r1' }])
  const wrongAcks: WorkerLeaderFrame[] = []
  handleWorkerFrame(f.db, 'c2', { type: 'worker.done', runId: 'r1', status: 'completed', text: 'dup', items: [] }, sock, Date.now(), 64, collector(wrongAcks), f.runner.bridge)
  expect(wrongAcks).toEqual([])

  const cont = f.runner.run(f.runInput('r2', 't1', { prompt: 'follow up' }))
  expect(f.sent.at(-1)?.frame).toMatchObject({ type: 'worker.start', runId: 'r2', sessionId: 'sess-123' })
  f.runner.bridge.onFrame('c1', { type: 'worker.done', runId: 'r2', status: 'completed', text: 'ok2', items: [] }, f.sendTo('c1'))
  expect((await cont).text).toBe('ok2')
  disconnect()
})

test('offline grace reconnect, offline timeout, revocation, deleted bot, and leader restart recovery', async () => {
  const f = makeRunner()
  let disconnect = f.connect('c1')

  const p1 = f.runner.run(f.runInput('off-ok', 't1'))
  disconnect()
  await Bun.sleep(30)
  disconnect = f.connect('c1')
  f.runner.bridge.onFrame('c1', { type: 'worker.done', runId: 'off-ok', status: 'completed', text: 'survived', items: [] }, f.sendTo('c1'))
  expect((await p1).text).toBe('survived')

  const p2 = f.runner.run(f.runInput('off-die', 't2'))
  disconnect()
  expect(await p2).toMatchObject({ status: 'failed', failureReason: 'offline', unknownReceipt: true })

  disconnect = f.connect('c1')
  const p3 = f.runner.run(f.runInput('rev-1', 't3'))
  f.revoked.add('c1')
  disconnect()
  expect(await p3).toMatchObject({ status: 'failed', failureReason: 'computer_removed' })
  f.revoked.delete('c1')

  // Deleted bot mid-run refuses MCP and stops run.
  disconnect = f.connect('c1')
  const pDel = f.runner.run(f.runInput('del-1', 'td'))
  f.exists.delete('b1')
  f.runner.bridge.onFrame('c1', { type: 'worker.mcp.request', runId: 'del-1', callId: 'm1', body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' }, f.sendTo('c1'))
  expect(f.sent.some(s => s.frame.type === 'worker.mcp.response' && s.frame.callId === 'm1' && s.frame.status === 403)).toBe(true)
  expect(await pDel).toMatchObject({ status: 'stopped' })
  f.exists.add('b1')

  // Leader restart: worker.done arrives BEFORE run() re-attaches -> run() returns stored outcome immediately.
  void f.runner.run(f.runInput('restart-1', 't4'))
  f.runner.close()

  const restarted = new RemoteWorkerRunner({ db: f.db, botExists: () => true, handleMcp: async () => ({ status: 200, body: '{}' }), offlineGraceMs: 300 })
  cleanups.push(() => restarted.close())
  const acks2: WorkerLeaderFrame[] = []
  const d2 = restarted.bridge.onConnect!('c1', collector(acks2))
  expect(restarted.bridge.hasRun('c1', 'restart-1')).toBe(true)
  restarted.bridge.onFrame('c1', { type: 'worker.done', runId: 'restart-1', sessionId: 'sess-r1', status: 'completed', text: 'during-restart', items: [] }, collector(acks2))
  expect(acks2).toEqual([{ type: 'worker.ack', runId: 'restart-1' }])
  expect(await restarted.run(f.runInput('restart-1', 't4'))).toMatchObject({ status: 'completed', text: 'during-restart', sessionId: 'sess-r1' })
  d2()
})
