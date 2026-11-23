import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemoteWorkers } from '../../server/app-remote-workers'
import { DelegationService } from '../../server/threads/delegation-service'
import { answerPrompt, workPrompt, workRunOptions } from '../../server/threads/thread-prompts'
import { ThreadService } from '../../server/threads/thread-service'
import { ThreadStore } from '../../server/threads/thread-store'
import type { WorkerAgentInfo, WorkerDriverId } from '../../shared/worker-frame-schema'
import { makeCoreFixture } from './remote-worker-fake-cli'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(botEngineId: string, agents: WorkerAgentInfo[], botModel = { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-5-5' }) {
  const root = mkdtempSync(join(tmpdir(), 'rw-engine-choice-'))
  dirs.push(root)
  const cwd = join(root, 'repo')
  mkdirSync(cwd, { recursive: true })
  const core = makeCoreFixture(root, [{ id: 'b1', name: 'Dev Bot', model: botModel, engineId: botEngineId }])
  const compId = 'comp-1'
  const hasRunnable = agents.some(a => a.supported !== false)
  const updateAgents = (next: WorkerAgentInfo[]) => {
    core.compStore.add(
      compId,
      {
        name: 'Studio',
        os: 'darwin',
        home: root,
        capabilities: next.some(a => a.supported !== false) ? ['exec', 'worker'] : ['exec'],
        ...(next.length ? { workerAgents: next } : {})
      },
      'pub'
    )
  }
  updateAgents(agents)
  core.computers.connect(
    compId,
    () => {},
    () => {}
  )
  if (!hasRunnable) core.compStore.seen(compId)

  const rw = createRemoteWorkers({
    database: core.db,
    computers: core.computers,
    store: core.bots,
    memory: core.memory,
    skills: core.skills,
    handleMcp: async () => ({ status: 200, body: '{}' }),
    computersChanged: () => {}
  })
  const threadStore = new ThreadStore(core.db)
  const host = {
    requireBot: async (id: string) => ({ id, name: core.bots.get(id).name }),
    listBots: async () => core.bots.list().map(b => ({ id: b.id, name: b.name })),
    computerName: rw.computerName,
    resolveRemoteWorker: rw.resolveRemoteWorker,
    folder: async () => root,
    runRoutine: async () => ({ status: 'completed', text: 'ok' })
  }
  const threads = new ThreadService(threadStore, host)
  const delegation = new DelegationService(threads, host, async () => 'main-chat')
  return { root, cwd, compId, core, rw, threadStore, delegation, updateAgents }
}

test('hermes bot falls back to claude-code on a claude-only computer, tells the bot, and keeps engine on continuation', async () => {
  const f = setup('hermes', [
    { driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true },
    { driver: 'codex', version: '0.170.0', supported: false, signedIn: true }
  ])
  const res = await f.delegation.delegate('b1', {
    requestId: 'req-1',
    tasks: [{ worker: true, computer: 'Studio', cwd: f.cwd, task: 'Build app' }]
  })
  const ex = res.exchanges[0] as Record<string, unknown>
  expect(ex.engine).toBe('claude-code')
  expect(ex.fallbackFrom).toBe('hermes')
  expect(String(ex.fallbackNote)).toContain('hermes')
  expect(String(ex.fallbackNote)).toContain('claude-code')

  const thread = f.threadStore.get(String(ex.exchangeId))
  expect(thread.workerEngine).toBe('claude-code')
  expect(thread.workerEngineFallbackFrom).toBe('hermes')
  expect(workRunOptions(thread, true)).toMatchObject({ engine: 'claude-code' })
  const d = f.threadStore.pending()[0]
  expect(workPrompt(d, thread, 'Dev Bot', [], [])).toContain('using engine "claude-code"')
  expect(answerPrompt(thread, 'Dev Bot', 'done', [], null)).toContain('using engine "claude-code", fell back from "hermes"')

  // Continuation keeps claude-code even if hermes later becomes supported on that computer.
  f.updateAgents([
    { driver: 'hermes', version: '0.23.1', supported: true, signedIn: true },
    { driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true }
  ])
  const cont = await f.delegation.delegate('b1', {
    requestId: 'req-2',
    tasks: [{ exchangeId: thread.id, task: 'Follow up' }]
  })
  expect((cont.exchanges[0] as Record<string, unknown>).engine).toBe('claude-code')
  expect((cont.exchanges[0] as Record<string, unknown>).fallbackFrom).toBeUndefined()

  // Rejects passing engine on continuation.
  await expect(f.delegation.delegate('b1', { requestId: 'req-bad-cont', tasks: [{ exchangeId: thread.id, engine: 'hermes', task: 'Switch?' }] })).rejects.toThrow(
    /engine applies only when starting a new worker/
  )

  // If the thread's recorded engine is removed, continuation fails instead of silently switching to hermes.
  f.updateAgents([{ driver: 'hermes', version: '0.23.1', supported: true, signedIn: true }])
  await expect(f.delegation.delegate('b1', { requestId: 'req-3', tasks: [{ exchangeId: thread.id, task: 'Continue' }] })).rejects.toMatchObject({
    code: 'engine_unavailable'
  })
  f.core.db.close()
})

test('explicit engine request succeeds when supported and refuses without fallback when missing or unsupported', async () => {
  const f = setup('hermes', [
    { driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true },
    { driver: 'codex', version: '0.170.0', supported: false, signedIn: true }
  ])
  const ok = await f.delegation.delegate('b1', {
    requestId: 'exp-1',
    tasks: [{ worker: true, computer: 'Studio', cwd: f.cwd, engine: 'claude-code', task: 'Use claude' }]
  })
  expect((ok.exchanges[0] as Record<string, unknown>).engine).toBe('claude-code')
  expect((ok.exchanges[0] as Record<string, unknown>).fallbackFrom).toBeUndefined()

  await expect(
    f.delegation.delegate('b1', {
      requestId: 'exp-2',
      tasks: [{ worker: true, computer: 'Studio', cwd: f.cwd, engine: 'hermes', task: 'Want hermes' }]
    })
  ).rejects.toMatchObject({ code: 'engine_unavailable' })

  await expect(
    f.delegation.delegate('b1', {
      requestId: 'exp-3',
      tasks: [{ worker: true, computer: 'Studio', cwd: f.cwd, engine: 'codex', task: 'Want codex' }]
    })
  ).rejects.toMatchObject({ code: 'engine_unsupported' })
  f.core.db.close()
})

test('older helper reporting only driver and version works, and non-hermes bots match their own engine', async () => {
  const legacy = setup('hermes', [{ driver: 'claude-code', version: '2.1.327' }])
  const res = await legacy.delegation.delegate('b1', {
    requestId: 'leg-1',
    tasks: [{ worker: true, computer: 'Studio', cwd: legacy.cwd, task: 'Legacy helper' }]
  })
  expect((res.exchanges[0] as Record<string, unknown>).engine).toBe('claude-code')
  legacy.core.db.close()

  const claudeBot = setup('claude-code', [
    { driver: 'hermes', version: '0.23.1', supported: true, signedIn: true },
    { driver: 'claude-code', version: '2.1.327', supported: true, signedIn: true }
  ])
  const same = await claudeBot.delegation.delegate('b1', {
    requestId: 'cb-1',
    tasks: [{ worker: true, computer: 'Studio', cwd: claudeBot.cwd, task: 'Same engine' }]
  })
  expect((same.exchanges[0] as Record<string, unknown>).engine).toBe('claude-code')
  expect((same.exchanges[0] as Record<string, unknown>).fallbackFrom).toBeUndefined()
  claudeBot.core.db.close()
})

test('leader worker accepts matching engine and refuses mismatched engine', async () => {
  const f = setup('hermes', [{ driver: 'claude-code', version: '2.1.327', supported: true }])
  const ok = await f.delegation.delegate('b1', {
    requestId: 'lead-1',
    tasks: [{ worker: true, engine: 'hermes' as WorkerDriverId, task: 'On leader' }]
  })
  expect(ok.exchanges[0].worker).toBe(true)
  await expect(
    f.delegation.delegate('b1', {
      requestId: 'lead-2',
      tasks: [{ worker: true, computer: 'leader', engine: 'claude-code', task: 'Wrong engine on leader' }]
    })
  ).rejects.toMatchObject({ code: 'engine_unavailable' })
  f.core.db.close()
})
