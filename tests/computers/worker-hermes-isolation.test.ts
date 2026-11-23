import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hermesDriver } from '../../helper/drivers/hermes/worker-driver-hermes'
import { WorkerHost } from '../../helper/worker-host'
import { acknowledgeWorker, sessionsToPrune } from '../../helper/worker-journal'
import { normalizeWorkerAgents, selectRemoteWorkerEngine } from '../../server/computers/remote-worker-select'
import { startMockHermesGateway } from './worker-hermes-mock'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

test('WorkerHost marks created_by_helper only on fresh session.create and isolates personal MCP servers via no_mcp', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-iso-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const db = new Database(':memory:')
  cleanups.push(() => db.close())
  const observedTools: string[][] = []
  const gw = startMockHermesGateway(
    {
      onSubmit(ws, params, reqs) {
        const create = params.session_id === 'local-s1' ? [...reqs].reverse().find(r => r.method === 'session.create')?.params : undefined
        const toolsets: string[] = Array.isArray(create?.toolsets) ? create.toolsets : []
        // Mirrors Hermes `_merge_mcp_servers`: omitting `no_mcp` leaks personal `config.yaml` MCP servers.
        const leaked = create && !toolsets.includes('no_mcp') ? ['personal_secret_tool'] : []
        const scoped = create?.editor?.mcp_servers?.length ? ['lilbot_memory_save'] : []
        if (create) observedTools.push([...leaked, ...scoped])
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: { type: 'message.complete', session_id: params.session_id, execution_generation: 1, payload: { status: 'complete', text: 'ok' } }
          })
        )
      }
    },
    fn => cleanups.push(fn)
  )
  const settled = new Set<string>()
  let resolveAll!: () => void
  const allDone = new Promise<void>(r => {
    resolveAll = r
  })
  const host = new WorkerHost({
    db,
    send: (_k, frame: any) => {
      if (frame?.type === 'worker.done') {
        settled.add(frame.runId)
        if (settled.size === 2) resolveAll()
      }
    },
    emitNow: () => true,
    drivers: [hermesDriver({ db, attach: async () => ({ url: gw.url, protocols: [] }) })]
  })
  host.handle({
    type: 'worker.start',
    runId: 'narrow-1',
    driver: 'hermes',
    cwd: dir,
    model: 'anthropic/claude-sonnet-5-5',
    prompt: 'hi',
    mcpEnabled: true,
    capabilities: ['computers']
  })
  host.handle({
    type: 'worker.start',
    runId: 'leader-sid-1',
    driver: 'hermes',
    sessionId: 'user-cli-99',
    cwd: dir,
    model: 'anthropic/claude-sonnet-5-5',
    prompt: 'hi',
    mcpEnabled: false
  })
  await allDone

  expect(observedTools[0]).toEqual(['lilbot_memory_save'])
  expect((db.query('SELECT created_by_helper FROM worker_runs WHERE run_id=?').get('narrow-1') as { created_by_helper: number }).created_by_helper).toBe(1)
  expect((db.query('SELECT created_by_helper FROM worker_runs WHERE run_id=?').get('leader-sid-1') as { created_by_helper: number }).created_by_helper).toBe(0)

  acknowledgeWorker(db, 'narrow-1')
  acknowledgeWorker(db, 'leader-sid-1')
  db.query('UPDATE worker_runs SET updated_at=?').run(Date.now() - 8 * 24 * 60 * 60 * 1000)
  expect(sessionsToPrune(db, 'hermes', Date.now() - 7 * 24 * 60 * 60 * 1000)).toEqual(['local-s1'])
})

test('checkpoint_required unavailability refuses explicit requests naming the setting and lets defaults fall back', () => {
  const blockedHermes = { driver: 'hermes' as const, version: '0.23.1', supported: false, unavailableReason: 'checkpoint_required', signedIn: true }
  const claude = { driver: 'claude-code' as const, version: '2.1.327', supported: true, signedIn: true }

  // Default choice falls back to another runnable engine with the usual notice.
  expect(selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: [blockedHermes, claude] })).toEqual({
    ok: true,
    driver: 'claude-code',
    fallback: true,
    fallbackFrom: 'hermes'
  })
  // Explicit request refuses fast naming compression.checkpoint_required and never falls back.
  const explicit = selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: [blockedHermes, claude], requestedEngine: 'hermes' })
  expect(explicit.ok).toBe(false)
  if (!explicit.ok) {
    expect(explicit.code).toBe('engine_unsupported')
    expect(explicit.message).toContain('compression.checkpoint_required')
    expect(explicit.message).toContain('claude-code')
  }
  // Hermes-only computer refuses default choice naming compression.checkpoint_required.
  const onlyBlocked = selectRemoteWorkerEngine({ computerName: 'Box', botEngineId: 'hermes', agents: [blockedHermes] })
  expect(onlyBlocked.ok).toBe(false)
  if (!onlyBlocked.ok) {
    expect(onlyBlocked.code).toBe('computer_no_worker')
    expect(onlyBlocked.message).toContain('compression.checkpoint_required')
  }
  // Hostile helper claiming supported: true alongside an unknown reason is neutralized and stripped.
  const hostile = normalizeWorkerAgents([{ driver: 'hermes', version: '0.23.1', supported: true, unavailableReason: 'bogus_reason' }])
  expect(hostile).toEqual([{ driver: 'hermes', version: '0.23.1', supported: false }])
})
