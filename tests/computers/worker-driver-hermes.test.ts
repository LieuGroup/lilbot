import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WorkerProgressEvent } from '../../helper/worker-driver'
import { hermesDriver } from '../../helper/worker-driver-hermes'
import { acknowledgeWorker, finishWorkerRecord, prepareWorkerJournal, startWorkerRecord } from '../../helper/worker-journal'
import { startMockHermesGateway } from './worker-hermes-mock'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-drv-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('hermesDriver runs start -> approvals -> MCP tool -> steer (stale_generation retry) -> completion + 7d pruning', async () => {
  const dir = makeTempDir()
  const db = new Database(':memory:')
  cleanups.push(() => db.close())
  prepareWorkerJournal(db)
  startWorkerRecord(db, 'old-run', 'local-old-7d', 'hermes')
  finishWorkerRecord(db, { type: 'worker.done', runId: 'old-run', sessionId: 'local-old-7d', status: 'completed', text: 'ok', items: [] })
  acknowledgeWorker(db, 'old-run')
  db.query('UPDATE worker_runs SET updated_at=? WHERE run_id=?').run(Date.now() - 8 * 24 * 60 * 60 * 1000, 'old-run')
  startWorkerRecord(db, 'fresh-run', 'local-fresh', 'hermes')
  finishWorkerRecord(db, { type: 'worker.done', runId: 'fresh-run', sessionId: 'local-fresh', status: 'completed', text: 'ok', items: [] })
  acknowledgeWorker(db, 'fresh-run')

  let steerAttempts = 0
  let activeWs: any
  const gw = startMockHermesGateway(
    {
      onSubmit(ws) {
        activeWs = ws
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: {
              type: 'approval.request',
              session_id: 'local-s1',
              execution_generation: 1,
              payload: { kind: 'approval', prompt_id: 'apr-1', execution_generation: 1, choices: ['once', 'deny'] }
            }
          })
        )
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srq-1', method: 'approval', params: { session_id: 'local-s1', request_id: 'apr-2' } }))
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: {
              type: 'tool.start',
              session_id: 'local-s1',
              execution_generation: 1,
              payload: { tool_id: 'tc1', name: 'mcp__editor_lilbot_system_1234abcd__lilbot_work', context: 'update work' }
            }
          })
        )
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: { type: 'tool.complete', session_id: 'local-s1', execution_generation: 1, payload: { tool_id: 'tc1', result: '{"ok":true}' } }
          })
        )
      },
      onSteer() {
        steerAttempts++
        if (steerAttempts === 1) return { error: { reason: 'stale_generation', data: { execution_generation: 2 } } }
        return { result: { status: 'queued', text: 'change plan', execution_generation: 2, authority_epoch: 1 } }
      },
      resumeDisplayMessages: [{ role: 'assistant', text: 'Finished cleanly without secret_tok_42.' }]
    },
    fn => cleanups.push(fn)
  )

  const events: WorkerProgressEvent[] = []
  const handle = hermesDriver({ db, attach: async () => ({ url: gw.url, protocols: [] }) }).start(
    {
      runId: 'run-1',
      cwd: dir,
      model: 'anthropic/claude-sonnet-5-5',
      provider: 'cliproxyapi',
      reasoningEffort: 'high',
      systemPrompt: 'Sys prompt',
      prompt: 'Do task',
      mcp: { url: 'http://127.0.0.1:9999/mcp', token: 'secret_tok_42' }
    },
    ev => events.push(ev)
  )

  await Bun.sleep(60)
  expect(await handle.steer('change plan')).toBe('steered')
  expect(steerAttempts).toBe(2)

  activeWs.send(
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'event',
      params: {
        type: 'message.complete',
        session_id: 'local-s1',
        execution_generation: 2,
        payload: { status: 'complete', text: 'Finished cleanly without secret_tok_42.', usage: { input: 200, output: 50, context_used: 250, context_max: 200_000 } }
      }
    })
  )
  const out = await handle.done

  expect(out.status).toBe('completed')
  expect(out.sessionId).toBe('local-s1')
  expect(out.text).toBe('Finished cleanly without [redacted].')
  expect(out.usage).toEqual({ inputTokens: 200, outputTokens: 50, contextTokens: 250, contextWindow: 200_000 })
  expect(events.some(e => e.tools?.[0]?.name === 'lilbot_work')).toBe(true)

  const createReq = gw.requests.find(r => r.method === 'session.create')?.params
  expect(createReq).toMatchObject({ source: 'acp', hidden: true, yolo: true, ignore_rules: true, client_env: { HERMES_EPHEMERAL_SYSTEM_PROMPT: 'Sys prompt' } })
  expect(createReq.editor.mcp_servers[0].url).toBe('http://127.0.0.1:9999/mcp')
  expect(gw.requests.some(r => r.method === 'session.mutate' && r.params.operation === 'edit_policy' && r.params.payload.policy === 'session')).toBe(true)
  expect(gw.requests.some(r => r.method === 'approval.respond' && r.params.prompt_id === 'apr-1' && r.params.choice === 'once')).toBe(true)
  expect(gw.serverResponses).toEqual([{ id: 'srq-1', result: { choice: 'once' } }])
  expect(gw.requests.some(r => r.method === 'session.mutate' && r.params.operation === 'delete' && r.params.session_id === 'local-old-7d')).toBe(true)
  expect(gw.requests.some(r => r.method === 'session.mutate' && r.params.operation === 'delete' && r.params.session_id === 'local-fresh')).toBe(false)
  expect((db.query('SELECT pruned_at FROM worker_runs WHERE run_id=?').get('old-run') as { pruned_at: number | null }).pruned_at).not.toBeNull()
})
