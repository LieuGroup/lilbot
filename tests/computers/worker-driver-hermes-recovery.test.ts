import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hermesDriver } from '../../helper/worker-driver-hermes'
import { WorkerHost } from '../../helper/worker-host'
import { getWorkerRun } from '../../helper/worker-journal'
import { startMockHermesGateway } from './worker-hermes-mock'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-rec-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('hermesDriver handles resume, mid-turn WS drop recovery, stop, unsigned fast-fail, detect, skew, and P8 decoupling', async () => {
  const dir = makeTempDir()
  const fakeHermes = join(dir, 'hermes')
  writeFileSync(fakeHermes, '#!/bin/sh\necho "Hermes Agent v0.23.1"\n')
  chmodSync(fakeHermes, 0o755)
  writeFileSync(join(dir, 'config.yaml'), 'model:\n  provider: anthropic\n')
  expect(await hermesDriver({ bin: fakeHermes, hermesHome: dir, env: {} }).detect()).toEqual({ driver: 'hermes', version: '0.23.1', supported: true, signedIn: true })

  // 1. Unsigned fast-fail never calls session.create
  const gwNoAuth = startMockHermesGateway({ modelOptions: { providers: [] } }, fn => cleanups.push(fn))
  const failOut = await hermesDriver({ attach: async () => ({ url: gwNoAuth.url, protocols: [] }) }).start(
    { runId: 'no-auth', cwd: dir, model: 'anthropic/claude-sonnet-5-5', prompt: 'hi' },
    () => {}
  ).done
  expect(failOut.status).toBe('failed')
  expect(failOut.error).toContain('hermes model')
  expect(gwNoAuth.requests.some(r => r.method === 'session.create')).toBe(false)

  // 2. Resume rebinds rotated MCP server and slices transcript past baseline
  const gwResume = startMockHermesGateway(
    {
      resumeDisplayMessages: [
        { role: 'assistant', text: 'earlier' },
        { role: 'assistant', text: 'continued' }
      ],
      onSubmit(ws) {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: { type: 'message.complete', session_id: 'local-prev', execution_generation: 1, payload: { status: 'complete', text: 'continued' } }
          })
        )
      }
    },
    fn => cleanups.push(fn)
  )
  const resOut = await hermesDriver({ attach: async () => ({ url: gwResume.url, protocols: [] }) }).start(
    { runId: 'cont-1', sessionId: 'local-prev', cwd: dir, model: 'anthropic/claude-sonnet-5-5', prompt: 'more', mcp: { url: 'http://127.0.0.1:8888/mcp', token: 'tok2' } },
    () => {}
  ).done
  expect(resOut.status).toBe('completed')
  expect(gwResume.requests.some(r => r.method === 'session.mutate' && r.params.operation === 'editor_mcp')).toBe(true)

  // 3. Dropped WS mid-turn recovers via re-attach + session.resume + prompt.receipt
  const gwDrop = startMockHermesGateway(
    {
      resumeDisplayMessages: [{ role: 'assistant', text: 'recovered answer' }],
      receipt: { status: 'terminal', outcome: 'completed' },
      onSubmit(ws) {
        setTimeout(() => ws.close(), 20)
      }
    },
    fn => cleanups.push(fn)
  )
  const dropOut = await hermesDriver({ attach: async () => ({ url: gwDrop.url, protocols: [] }) }).start(
    { runId: 'drop-1', cwd: dir, model: 'anthropic/claude-sonnet-5-5', prompt: 'survive drop' },
    () => {}
  ).done
  expect(dropOut.status).toBe('completed')
  expect(dropOut.text).toBe('recovered answer')
  expect(gwDrop.requests.some(r => r.method === 'prompt.receipt')).toBe(true)

  // 4. Stop mid-run sends session.interrupt and resolves stopped
  const gwStop = startMockHermesGateway(
    {
      onInterrupt(ws) {
        ws.send(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'event',
            params: { type: 'message.complete', session_id: 'local-s1', execution_generation: 1, payload: { status: 'interrupted', text: 'partial' } }
          })
        )
      }
    },
    fn => cleanups.push(fn)
  )
  const stopHandle = hermesDriver({ attach: async () => ({ url: gwStop.url, protocols: [] }), stopGraceMs: 500 }).start(
    { runId: 'stop-1', cwd: dir, model: 'anthropic/claude-sonnet-5-5', prompt: 'long' },
    () => {}
  )
  await Bun.sleep(50)
  stopHandle.stop()
  expect((await stopHandle.done).status).toBe('stopped')
  expect(gwStop.requests.some(r => r.method === 'session.interrupt')).toBe(true)

  // 5. Version skew: WorkerHost dispatches an old server frame omitting `driver` to the legacyDefault driver.
  const skewDb = new Database(':memory:')
  cleanups.push(() => skewDb.close())
  const picked: string[] = []
  const host = new WorkerHost({
    db: skewDb,
    send: () => {},
    emitNow: () => true,
    drivers: [
      {
        id: 'hermes',
        detect: async () => null,
        start: () => {
          picked.push('hermes')
          return { steer: async () => 'not_running', stop: () => {}, done: Promise.resolve({ status: 'completed', text: '', items: [] }) }
        }
      },
      {
        id: 'claude-code',
        legacyDefault: true,
        detect: async () => null,
        start: () => {
          picked.push('claude-code')
          return { steer: async () => 'not_running', stop: () => {}, done: Promise.resolve({ status: 'completed', text: '', items: [] }) }
        }
      }
    ]
  })
  host.handle({ type: 'worker.start', runId: 'skew-1', cwd: dir, model: 'claude-sonnet-5-5', prompt: 'hi', mcpEnabled: false })
  await Bun.sleep(20)
  expect(picked).toEqual(['claude-code'])
  expect(getWorkerRun(skewDb, 'skew-1')?.run_id).toBe('skew-1')

  // 6. P8 decoupling: shared helper modules and Hermes driver files never import Claude-Code driver modules.
  for (const file of [
    'helper/worker-host.ts',
    'helper/worker-bin.ts',
    'helper/worker-text.ts',
    'helper/worker-probes.ts',
    'helper/worker-journal.ts',
    'helper/worker-mcp-proxy.ts',
    'helper/worker-driver-hermes.ts',
    'helper/worker-hermes-env.ts',
    'helper/worker-hermes-model.ts',
    'helper/worker-hermes-protocol.ts',
    'helper/worker-hermes-prune.ts',
    'helper/worker-hermes-session.ts',
    'helper/worker-hermes-socket.ts'
  ]) {
    expect(readFileSync(file, 'utf8')).not.toMatch(/worker-claude|worker-driver-claude/)
  }
})
