import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hermesDriver } from '../../helper/drivers/hermes/worker-driver-hermes'
import type { WorkerProgressEvent } from '../../helper/worker-driver'
import { acknowledgeWorker, finishWorkerRecord, prepareWorkerJournal, startWorkerRecord, updateWorkerSession } from '../../helper/worker-journal'
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

function seedAgedRun(db: Database, runId: string, sessionId: string, createdByHelper: boolean, ageDays = 8) {
  startWorkerRecord(db, runId, createdByHelper ? undefined : sessionId, 'hermes')
  if (createdByHelper) updateWorkerSession(db, runId, sessionId, true)
  finishWorkerRecord(db, { type: 'worker.done', runId, sessionId, status: 'completed', text: 'ok', items: [] })
  acknowledgeWorker(db, runId)
  if (ageDays > 0) db.query('UPDATE worker_runs SET updated_at=? WHERE run_id=?').run(Date.now() - ageDays * 24 * 60 * 60 * 1000, runId)
}

test('hermesDriver runs start -> scoped approvals -> MCP tool -> steer -> completion + safe 7d pruning', async () => {
  const dir = makeTempDir()
  const db = new Database(':memory:')
  cleanups.push(() => db.close())
  prepareWorkerJournal(db)
  seedAgedRun(db, 'old-run', 'local-old-7d', true, 8)
  seedAgedRun(db, 'fresh-run', 'local-fresh', true, 0)
  // Leader-supplied user session id (never created by this helper) must NEVER be pruned even after 8 days.
  seedAgedRun(db, 'spoof-user', 'user-cli-session', false, 8)
  // Even if marked created_by_helper, a live visible acp session (scope: 'live'; Hermes omits acp from scope: 'stored'),
  // a stored visible session (scope: 'stored'), or a non-acp session must NEVER be pruned.
  seedAgedRun(db, 'visible-row', 'visible-acp-1', true, 8)
  seedAgedRun(db, 'stored-vis-row', 'visible-stored-1', true, 8)
  seedAgedRun(db, 'cli-row', 'real-cli-1', true, 8)

  let steerAttempts = 0
  let activeWs: any
  const gw = startMockHermesGateway(
    {
      liveVisibleSessions: [{ session_id: 'visible-acp-1', source: 'acp' }],
      storedVisibleSessions: [{ session_id: 'visible-stored-1', source: 'cli' }],
      sessionInfoFor(sid) {
        if (sid === 'real-cli-1') return { source: 'cli', launch_request: { source: 'cli' } }
        return { source: 'acp', launch_request: { source: 'acp', yolo: true, ignore_rules: true } }
      },
      onOpen(ws) {
        // Approval arriving before session.create resolves must be ignored (fail closed).
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srq-early', method: 'approval', params: { session_id: 'local-s1', request_id: 'apr-early' } }))
      },
      onSubmit(ws) {
        activeWs = ws
        // Cross-session and missing-session approvals must NEVER be answered.
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: { type: 'approval.request', session_id: 'other-session', execution_generation: 1, payload: { kind: 'approval', prompt_id: 'apr-other' } }
          })
        )
        ws.send(
          JSON.stringify({ jsonrpc: '2.0', method: 'event', params: { type: 'approval.request', execution_generation: 1, payload: { kind: 'approval', prompt_id: 'apr-nosid' } } })
        )
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srq-other', method: 'approval', params: { session_id: 'other-session', request_id: 'apr-s-other' } }))
        ws.send(JSON.stringify({ jsonrpc: '2.0', id: 'srq-nosid', method: 'approval', params: { request_id: 'apr-s-nosid' } }))
        // Own-session approvals MUST be answered.
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
  expect(events.some(e => e.sessionId === 'local-s1' && e.sessionCreated === true)).toBe(true)

  const createReq = gw.requests.find(r => r.method === 'session.create')?.params
  expect(createReq).toMatchObject({ source: 'acp', hidden: true, yolo: true, ignore_rules: true, client_env: { HERMES_EPHEMERAL_SYSTEM_PROMPT: 'Sys prompt' } })
  expect(createReq.toolsets).toContain('no_mcp')
  expect(createReq.editor.mcp_servers[0].url).toBe('http://127.0.0.1:9999/mcp')
  expect(gw.requests.filter(r => r.method === 'approval.respond').map(r => r.params.prompt_id)).toEqual(['apr-1'])
  expect(gw.serverResponses).toEqual([{ id: 'srq-1', result: { choice: 'once' } }])
  expect(
    gw.requests
      .filter(r => r.method === 'session.list')
      .map(r => r.params.scope)
      .sort()
  ).toEqual(['live', 'stored'])
  const deleted = gw.requests.filter(r => r.method === 'session.mutate' && r.params.operation === 'delete').map(r => r.params.session_id)
  expect(deleted).toEqual(['local-old-7d'])
  expect((db.query('SELECT pruned_at FROM worker_runs WHERE run_id=?').get('old-run') as { pruned_at: number | null }).pruned_at).not.toBeNull()
  expect((db.query('SELECT pruned_at FROM worker_runs WHERE run_id=?').get('spoof-user') as { pruned_at: number | null }).pruned_at).toBeNull()
})

test('hermesDriver refuses fast when compression.checkpoint_required is enabled without launching Hermes', async () => {
  const dir = makeTempDir()
  const fakeHermes = join(dir, 'hermes')
  writeFileSync(fakeHermes, '#!/bin/sh\nif [ "$1" = "gateway" ]; then exit 99; fi\necho "Hermes Agent v0.23.1"\n')
  chmodSync(fakeHermes, 0o755)
  writeFileSync(join(dir, 'config.yaml'), 'model:\n  provider: anthropic\ncompression:\n  checkpoint_required: true\n')

  const drv = hermesDriver({ bin: fakeHermes, hermesHome: dir, env: {} })
  expect(await drv.detect()).toEqual({
    driver: 'hermes',
    version: '0.23.1',
    supported: false,
    unavailableReason: 'checkpoint_required',
    signedIn: true
  })

  const out = await drv.start({ runId: 'ckpt-refuse', cwd: dir, model: 'anthropic/claude-sonnet-5-5', prompt: 'hi' }, () => {}).done
  expect(out.status).toBe('failed')
  expect(out.error).toContain('compression.checkpoint_required')
})
