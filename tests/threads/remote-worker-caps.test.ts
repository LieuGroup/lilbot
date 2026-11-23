import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemoteWorkers } from '../../server/app-remote-workers'
import { DelegationService } from '../../server/threads/delegation-service'
import { ThreadService } from '../../server/threads/thread-service'
import { ThreadStore } from '../../server/threads/thread-store'
import type { BotModel } from '../../shared/bot-schema'
import { DelegateInput } from '../../shared/thread-schema'
import { makeCoreFixture } from './remote-worker-fake-cli'

const dirs: string[] = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const CLAUDE: BotModel = { provider: 'anthropic', model: 'claude-sonnet-4-6' }
const GPT: BotModel = { provider: 'openai', model: 'gpt-5' }

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-rw-caps-'))
  dirs.push(dir)
  const core = makeCoreFixture(dir, [
    { id: 'b1', name: 'Bot One', model: CLAUDE },
    { id: 'b2', name: 'Bot Two', model: CLAUDE },
    { id: 'b3', name: 'Bot Three', model: CLAUDE }
  ])
  const rw = createRemoteWorkers({
    database: core.db,
    computers: core.computers,
    store: core.bots,
    memory: core.memory,
    skills: core.skills,
    handleMcp: async () => ({ status: 200, body: '{}' }),
    computersChanged: () => {}
  })
  const running = new Map<string, { resolve: (r: { status: string; text: string }) => void; computer?: string }>()
  const store = new ThreadStore(core.db)
  const baseHost = {
    requireBot: async (id: string) => ({ id, name: core.bots.get(id).name }),
    listBots: async () => core.bots.list().map(b => ({ id: b.id, name: b.name })),
    computerName: rw.computerName,
    folder: async (id: string) => join(dir, 'ws', id)
  }
  const threads = new ThreadService(store, {
    ...baseHost,
    runRoutine: (_botId, _prompt, opts) => new Promise(resolve => running.set(opts.runId, { resolve, computer: opts.computer }))
  })
  const delegation = new DelegationService(
    threads,
    { ...baseHost, runRoutine: async () => ({ status: 'completed', text: 'ok' }), resolveRemoteWorker: rw.resolveRemoteWorker },
    async () => 'main-chat'
  )
  return { ...core, rw, store, threads, delegation, running }
}

test('validation fails fast with zero side effects for bad inputs, computers, paths, models, files, and continuations', async () => {
  const f = fixture()
  const offlineId = f.addComputer('OfflineBox', false, true).id
  const noWorkerId = f.addComputer('ExecOnly', true, false).id
  const onlineId = f.addComputer('Studio', true, true).id
  f.addComputer('Dup', true, true)
  f.addComputer('Dup', true, true)

  expect(() => DelegateInput.parse({ requestId: 'r1', tasks: [{ to: 'Bot Two', computer: 'Studio', cwd: '/tmp', task: 'hi' }] })).toThrow()
  expect(() => DelegateInput.parse({ requestId: 'r1', tasks: [{ worker: true, cwd: '/tmp', task: 'hi' }] })).toThrow()
  expect(() => DelegateInput.parse({ requestId: 'r1', tasks: [{ computer: 'Studio', cwd: '/tmp', task: 'hi' }] })).toThrow()

  const badCases: Array<[Parameters<typeof f.delegation.delegate>[1], RegExp]> = [
    [{ requestId: 'e1', tasks: [{ worker: true, computer: 'Missing', cwd: '/tmp', task: 'hi' }] }, /not found/],
    [{ requestId: 'e2', tasks: [{ worker: true, computer: 'Dup', cwd: '/tmp', task: 'hi' }] }, /More than one computer/],
    [{ requestId: 'e3', tasks: [{ worker: true, computer: offlineId, cwd: '/tmp', task: 'hi' }] }, /offline/],
    [{ requestId: 'e4', tasks: [{ worker: true, computer: noWorkerId, cwd: '/tmp', task: 'hi' }] }, /does not advertise a coding agent/],
    [{ requestId: 'e5', tasks: [{ worker: true, computer: onlineId, task: 'hi' }] }, /Give a folder \(cwd\)/],
    [{ requestId: 'e6', tasks: [{ worker: true, computer: onlineId, cwd: 'relative/path', task: 'hi' }] }, /must be absolute/],
    [{ requestId: 'e7', tasks: [{ worker: true, computer: onlineId, cwd: '/tmp', model: GPT, task: 'hi' }] }, /Claude models/],
    [{ requestId: 'e8', tasks: [{ worker: true, computer: onlineId, cwd: '/tmp', files: ['a.txt'], task: 'hi' }] }, /cannot be attached/],
    [{ requestId: 'e9', tasks: [{ worker: true, computer: 'leader', cwd: '/tmp', task: 'hi' }] }, /only to remote computers/]
  ]
  for (const [input, pattern] of badCases) await expect(f.delegation.delegate('b1', input)).rejects.toThrow(pattern)
  expect(f.store.list('b1')).toHaveLength(0)

  const local = await f.delegation.delegate('b1', { requestId: 'ok-leader', tasks: [{ worker: true, computer: 'leader', task: 'local work' }] })
  expect(f.store.get(local.exchanges[0].exchangeId).computer).toBeUndefined()

  const remote = await f.delegation.delegate('b1', { requestId: 'ok-remote', tasks: [{ worker: true, computer: 'Studio', cwd: '/work/app', task: 'remote work' }] })
  const exId = remote.exchanges[0].exchangeId
  expect(remote.exchanges[0].computer).toBe('Studio')
  await expect(f.delegation.delegate('b1', { requestId: 'bad-cont-1', tasks: [{ exchangeId: exId, computer: 'leader', task: 'change' }] })).rejects.toThrow(
    /apply only when starting/
  )
  await expect(f.delegation.delegate('b1', { requestId: 'bad-cont-2', tasks: [{ exchangeId: exId, cwd: '/other', task: 'change' }] })).rejects.toThrow(/apply only when starting/)
  const cont = await f.delegation.delegate('b1', { requestId: 'ok-cont', tasks: [{ exchangeId: exId, task: 'follow up' }] })
  expect(cont.exchanges[0].computer).toBe('Studio')
  f.db.close()
})

test('cap interactions: workersPerComputer=2 queues excess without blocking admission (workersPerBot=3), other computers/bots, concurrentWorkers=4, concurrent=6, or answers', async () => {
  const f = fixture()
  const compA = f.addComputer('BoxA', true, true).id
  const compB = f.addComputer('BoxB', true, true).id

  const batch1 = await f.delegation.delegate('b1', {
    requestId: 'b1-3',
    tasks: [
      { worker: true, computer: compA, cwd: '/tmp/1', task: 'w1' },
      { worker: true, computer: compA, cwd: '/tmp/2', task: 'w2' },
      { worker: true, computer: compA, cwd: '/tmp/3', task: 'w3' }
    ]
  })
  expect(batch1.exchanges).toHaveLength(3)
  await expect(f.delegation.delegate('b1', { requestId: 'b1-4', tasks: [{ worker: true, computer: compB, cwd: '/tmp/4', task: 'w4' }] })).rejects.toThrow(/At most 3 workers/)

  await f.delegation.delegate('b2', {
    requestId: 'b2-3',
    tasks: [
      { worker: true, computer: compA, cwd: '/tmp/a', task: 'b2-a' },
      { worker: true, computer: compB, cwd: '/tmp/b1', task: 'b2-b1' },
      { worker: true, computer: compB, cwd: '/tmp/b2', task: 'b2-b2' }
    ]
  })
  await f.delegation.delegate('b3', {
    requestId: 'b3-mix',
    tasks: [
      { worker: true, task: 'b3-local' },
      { to: 'Bot One', task: 'non-worker-1' },
      { to: 'Bot Two', task: 'non-worker-2' }
    ]
  })

  f.threads.tick()
  await Bun.sleep(20)
  const active = [...f.running.values()]
  expect(active.filter(r => r.computer === compA)).toHaveLength(2)
  expect(active.filter(r => r.computer === compB)).toHaveLength(2)
  expect(active).toHaveLength(6)

  const firstA = [...f.running.entries()].find(([, v]) => v.computer === compA)!
  f.running.delete(firstA[0])
  firstA[1].resolve({ status: 'completed', text: 'done A1' })
  await Bun.sleep(25)
  f.threads.tick()
  await Bun.sleep(25)
  expect([...f.running.keys()].some(k => k.includes(':reply'))).toBe(true)
  expect([...f.running.values()].filter(r => r.computer === compA)).toHaveLength(2)
  f.db.close()
})

test('remote worker resolution and dispatch require full-access permissionMode', async () => {
  const f = fixture()
  const compId = f.addComputer('Studio', true, true).id
  const bot = f.bots.get('b1')
  f.bots.save({ ...bot, permissionMode: 'approval-required' })

  await expect(f.delegation.delegate('b1', { requestId: 'rw-perm', tasks: [{ worker: true, computer: 'Studio', cwd: '/work/app', task: 'hi' }] })).rejects.toThrow(
    /full-access mode/
  )
  expect(f.store.list('b1')).toHaveLength(0)

  const outcome = await f.rw.runForBot('b1', 'run', {
    runId: 'rw-perm-run',
    threadId: 'rw-perm-thread',
    computer: compId,
    cwd: '/work/app',
    onChat: () => {}
  })
  expect(outcome.status).toBe('failed')
  expect(outcome.failureReason).toBe('invalid_start')
  expect(outcome.text).toMatch(/full-access mode/)

  f.bots.save({ ...bot, permissionMode: 'full-access' })
  const narrowed = await f.rw.runForBot('b1', 'run', {
    runId: 'rw-narrow-run',
    threadId: 'rw-narrow-thread',
    computer: compId,
    cwd: '/work/app',
    capabilities: ['delegation'],
    onChat: () => {}
  })
  expect(narrowed.status).toBe('failed')
  expect(narrowed.failureReason).toBe('invalid_start')
  expect(narrowed.text).toMatch(/computers capability/)
  f.db.close()
})
