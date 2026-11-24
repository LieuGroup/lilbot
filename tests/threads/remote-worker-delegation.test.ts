/** End-to-end test of remote worker delegation over real `startPublicDoor`, `helper/runner.ts`,
 *  `createRemoteWorkers`, scoped `workerMcp`, `WorkService`, `ThreadService`, `DelegationService`, and `DelegationControl`. */
import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { claudeCodeDriver } from '../../helper/drivers/claude-code/worker-driver-claude'
import { run } from '../../helper/runner'
import { createRemoteWorkers } from '../../server/app-remote-workers'
import { startPublicDoor } from '../../server/http/public-door'
import { SystemChanges } from '../../server/system/system-changes'
import { createSystemServer } from '../../server/system/system-server'
import { CallingChats } from '../../server/threads/calling-chats'
import { DelegationControl } from '../../server/threads/delegation-control'
import { DelegationService } from '../../server/threads/delegation-service'
import { ThreadService } from '../../server/threads/thread-service'
import { ThreadStore } from '../../server/threads/thread-store'
import { WorkLinks } from '../../server/work/work-links'
import { WorkService } from '../../server/work/work-service'
import { WorkStore } from '../../server/work/work-store'
import { until } from '../helpers/until'
import { makeCoreFixture, writeDelegationFakeClaude } from './remote-worker-fake-cli'

const cleanups: (() => Promise<void> | void)[] = []
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!()
})

async function makeHarness() {
  const root = mkdtempSync(join(tmpdir(), 'rw-del-e2e-'))
  const workDir = join(root, 'repo')
  mkdirSync(workDir, { recursive: true })
  const core = makeCoreFixture(root, [
    { id: 'b1', name: 'Lead Bot', model: { provider: 'cliproxyapi', model: 'anthropic/claude-sonnet-4-6' }, instructions: 'REMOTE_MARKER instructions.' }
  ])
  const { id: compId, pair } = core.addComputer('Studio', false, false, 'studio-1')
  const noop = () => {}
  const work = new WorkService(new WorkStore(core.db), {
    requireBot: async id => ({ id, name: core.bots.get(id).name }),
    checkers: async () => [],
    checkModel: async () => null,
    callingChat: async () => 'main-chat',
    session: () => ({ origin: { kind: 'conversation', id: 'main-chat' }, askedBy: null }),
    libraryTitle: () => null,
    checkGoal: noop,
    waiting: noop,
    line: noop,
    tell: noop,
    changed: noop
  })
  const threadStore = new ThreadStore(core.db)
  let system!: ReturnType<typeof createSystemServer>
  const rw = createRemoteWorkers({
    database: core.db,
    computers: core.computers,
    store: core.bots,
    memory: core.memory,
    skills: core.skills,
    handleMcp: (ctx, body) => system.workerMcp(ctx, body),
    computersChanged: noop
  })
  const answers: string[] = []
  const host = {
    requireBot: async (id: string) => ({ id, name: core.bots.get(id).name }),
    listBots: async () => core.bots.list().map(b => ({ id: b.id, name: b.name })),
    computerName: rw.computerName,
    resolveRemoteWorker: rw.resolveRemoteWorker,
    folder: async () => root,
    stopRun: async (botId: string, chatId: string) => rw.runner.stopByChat(botId, chatId),
    steerRun: async (botId: string, chatId: string, text: string) => rw.runner.steerByChat(botId, chatId, text),
    runRoutine: async (botId: string, prompt: string, opts: any) => {
      if (opts.computer && opts.cwd && opts.threadId) return rw.runForBot(botId, prompt, opts)
      answers.push(prompt)
      return { status: 'completed', text: 'ack' }
    }
  }
  let closed = false
  const threads = new ThreadService(threadStore, host, () => queueMicrotask(() => !closed && threads.tick()))
  rw.runner.onToolCall(ev => threads.runner.sawTool(ev.chatId, ev.activity))
  const delegation = new DelegationService(threads, host, async () => 'main-chat', new WorkLinks(work, { clearFor: noop } as any))
  const control = new DelegationControl(threads, host)
  const emptyList = { list: () => [] } as any
  const dummy = {} as any
  const sysBots = { requireBot: host.requireBot, listBots: async () => core.bots.list().map(b => ({ ...b, isPrimary: true })), getBot: async () => dummy } as any
  system = createSystemServer({
    store: core.bots,
    bots: sysBots,
    workspaces: { pathFor: () => root } as any,
    computers: core.computers,
    t3: () => ({ state: 'signed_in' }) as any,
    commit: 'abc1234',
    dataDir: root,
    activity: { snapshot: () => ({}) } as any,
    memory: core.memory,
    memoryChanged: noop,
    history: dummy,
    skills: core.skills,
    delegation: { delegate: delegation.delegate.bind(delegation), control, attach: delegation.attach.bind(delegation) } as any,
    work,
    goals: dummy,
    routines: emptyList,
    giveFile: async () => dummy,
    library: emptyList,
    webhooks: emptyList,
    webhookRuns: dummy,
    connections: emptyList,
    calls: new CallingChats(),
    checkSessions: { refusal: () => null } as any,
    changes: new SystemChanges(core.db),
    engineToken: 'tok',
    port: 1
  })
  expect(rw.runner.bridge.eventSpacingMs).toBeUndefined()
  const door = startPublicDoor(core.computers, 0, { workers: { ...rw.runner.bridge, eventSpacingMs: 0 } })
  const driver = claudeCodeDriver({ bin: writeDelegationFakeClaude(root), configDir: root, killGraceMs: 300 })
  const controller = new AbortController()
  const keyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const identity = { id: compId, url: `http://127.0.0.1:${door.port}`, privateKey: keyPem, serverFingerprint: core.serverKey.fingerprint }
  const helper = run(identity, controller.signal, { configDir: root, drivers: [driver], coalesceMs: 5, retire: async () => {} })
  const tickTimer = setInterval(() => threads.tick(), 15)
  cleanups.push(async () => {
    closed = true
    clearInterval(tickTimer)
    controller.abort()
    await helper
    rw.runner.close()
    door.stop(true)
    core.computers.close()
    core.db.close()
    rmSync(root, { recursive: true, force: true })
  })
  await until(
    () =>
      core.computers
        .list()
        .find(c => c.id === compId)
        ?.capabilities.includes('worker') === true
  )
  return { workDir, memory: core.memory, work, threadStore, threads, delegation, control, answers }
}

const lastReply = (store: ThreadStore, id: string) =>
  store
    .get(id)
    .messages.at(-1)!
    .items.find(i => i.kind === 'assistant')!.text

// Explicit 15 s limits: each test boots a real helper door, WebSocket, and fake Claude Bun subprocesses.
test('remote worker lifecycle: scoped MCP, answer delivery, and continuation --resume', async () => {
  const f = await makeHarness()
  const started = await f.delegation.delegate('b1', {
    requestId: 'req-mcp',
    tasks: [{ worker: true, computer: 'Studio', cwd: f.workDir, reasoningEffort: 'high', task: 'MODE:MCP run build' }]
  })
  const exId = started.exchanges[0].exchangeId
  expect(started.exchanges[0].computer).toBe('Studio')
  await until(() => f.threadStore.get(exId).status === 'finished' && f.answers.length === 1)

  expect(JSON.parse(lastReply(f.threadStore, exId))).toMatchObject({
    ok: true,
    model: 'claude-sonnet-4-6',
    effort: 'high',
    resume: '',
    hasSys: true,
    toolCount: 6,
    workOk: true,
    memOk: true,
    nestedRefused: true,
    otherWorkRefused: true
  })
  expect(f.work.store.evidence(exId).some(e => e.proves === 'Remote build green')).toBe(true)
  expect(f.memory.panel('b1').facts.some(fact => fact.text === 'Remote worker saved a durable fact.')).toBe(true)
  expect((await f.control.status('b1', { exchangeIds: [exId] })).exchanges[0].computer).toBe('Studio')

  await f.delegation.delegate('b1', { requestId: 'req-cont', tasks: [{ exchangeId: exId, task: 'Follow up' }] })
  await until(() => f.answers.length === 2)
  expect(JSON.parse(lastReply(f.threadStore, exId)).resume).toMatch(/^claude-sess-/)
}, 15_000)

test('remote worker lifecycle: live activity, mid-run steer without duplicate turn, and cancel', async () => {
  const f = await makeHarness()
  const steered = await f.delegation.delegate('b1', { requestId: 'req-steer', tasks: [{ worker: true, computer: 'Studio', cwd: f.workDir, task: 'MODE:STEER inspect' }] })
  const sId = steered.exchanges[0].exchangeId
  await until(() => f.threads.view(f.threadStore.get(sId)).activity === 'Working with files')
  expect((await f.control.redirect('b1', { requestId: 'redir-1', exchangeId: sId, message: 'focus on tests' })).applied).toBe('now')
  await until(() => f.threadStore.get(sId).status === 'finished' && f.answers.length === 1)
  expect(lastReply(f.threadStore, sId)).toContain('STEER_OK:focus on tests')
  f.threads.tick()
  expect(f.threadStore.delivery('b1:redir-1')?.status).toBe('done')
  expect(f.threadStore.pending()).toEqual([])
  expect(f.threads.runner.running.size).toBe(0)
  expect(f.answers.length).toBe(1)

  const sleeping = await f.delegation.delegate('b1', { requestId: 'req-sleep', tasks: [{ worker: true, computer: 'Studio', cwd: f.workDir, task: 'MODE:SLEEP wait' }] })
  const slId = sleeping.exchanges[0].exchangeId
  await until(() => f.threads.view(f.threadStore.get(slId)).activity === 'Running commands')
  expect((await f.control.cancel('b1', slId)).status).toBe('cancelled')
}, 15_000)
