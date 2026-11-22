/** Regression tests for PR #235 High #1 (WorkAnswers + remote: chatId), Medium #3 (no synthetic claude fallback),
 *  Medium #5 (canStartDelivery accounts for restored in-flight runs), and Low #6 (exact id match before name). */
import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRemoteWorkers, remoteWorkAnswers } from '../../server/app-remote-workers'
import { createWork } from '../../server/app-work'
import { BotPrefsStore } from '../../server/bots/bot-prefs-store'
import { GoalStore } from '../../server/goals/goal-store'
import { LibraryStore } from '../../server/library/library-store'
import { RoutineStore } from '../../server/routines/routine-store'
import { CallingChats } from '../../server/threads/calling-chats'
import { DelegationService } from '../../server/threads/delegation-service'
import { canStartDelivery } from '../../server/threads/thread-limits'
import { ThreadService } from '../../server/threads/thread-service'
import { ThreadStore } from '../../server/threads/thread-store'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { WorkBoard } from '../../server/work/work-board'
import type { BotModel } from '../../shared/bot-schema'
import { until } from '../helpers/until'
import { makeCoreFixture } from './remote-worker-fake-cli'

const CLAUDE: BotModel = { provider: 'anthropic', model: 'claude-sonnet-4-6' }
const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function makeEnv() {
  const root = mkdtempSync(join(tmpdir(), 'rw-pr235-work-'))
  const core = makeCoreFixture(root, [{ id: 'b1', name: 'Lead', model: CLAUDE }])
  const prefs = new BotPrefsStore(core.db)
  prefs.setMainChat('b1', 'main-b1')
  const threadStore = new ThreadStore(core.db)
  const rw = createRemoteWorkers({
    database: core.db,
    computers: core.computers,
    store: core.bots,
    memory: core.memory,
    skills: core.skills,
    handleMcp: async () => ({ status: 200, body: '{}' }),
    computersChanged: () => {}
  })
  cleanups.push(() => {
    rw.runner.close()
    core.computers.close()
    core.db.close()
    rmSync(root, { recursive: true, force: true })
  })
  return { root, core, prefs, threadStore, rw }
}

test('PR #235 High #1: WorkAnswers routes remote: sendBack via oscarAnswer or sourceChat and interrupts via stopByChat', async () => {
  const { root, core, prefs, threadStore, rw } = makeEnv()
  const { id: compId } = core.addComputer('Studio', true, true, 'studio-1')
  const hermesRuns: Array<{ chatId?: string }> = []
  const hermesStops: string[] = []
  const historyRefs: string[] = []
  const stoppedRemote: string[] = []
  let online = true
  const host = {
    requireBot: async (id: string) => ({ id, name: core.bots.get(id).name }),
    listBots: async () => core.bots.list().map(b => ({ id: b.id, name: b.name })),
    folder: async () => root,
    computerName: rw.computerName,
    resolveRemoteWorker: rw.resolveRemoteWorker,
    runRoutine: async () => ({ status: 'completed', text: 'ok' })
  }
  const threads = new ThreadService(threadStore, host)
  const remoteWork = remoteWorkAnswers(threadStore, () => ({
    computerOnline: id => id === compId && online,
    oscarAnswer: (id, reqId, text) => threads.oscarAnswer(id, reqId, text),
    changed: () => threads.changed(),
    stopByChat: async (_b, chatId) => {
      stoppedRemote.push(chatId)
      return true
    }
  }))
  const { work, answers, links } = createWork({
    database: core.db,
    engine: {
      id: 'fake',
      stopRun: async (_eb: string, chatId: string) => {
        hermesStops.push(chatId)
        return true
      }
    } as any,
    store: core.bots,
    prefs,
    bots: {
      requireBot: host.requireBot,
      listBots: async () => [{ id: 'b1', name: 'Lead', runnable: true }],
      runRoutine: async (_b: string, _p: string, o: { chatId?: string }) => {
        hermesRuns.push({ chatId: o.chatId })
        return { status: 'completed', text: 'ok' }
      }
    } as any,
    threadStore,
    routineStore: new RoutineStore(core.db),
    webhookStore: new WebhookStore(core.db),
    rootOf: (_b, id) => id,
    goalStore: new GoalStore(core.db),
    libraryStore: new LibraryStore(core.db),
    workspaces: { pathFor: () => root } as any,
    activity: { observe: () => {} } as any,
    history: { reference: (_b, chatId) => historyRefs.push(chatId) },
    calls: new CallingChats(),
    reviewModel: null,
    publish: () => {},
    remoteWork
  })
  const board = new WorkBoard(work, answers, threads)
  const delegation = new DelegationService(threads, host, async () => 'src-chat-1', links)
  const exId = (await delegation.delegate('b1', { requestId: 'r-h1', tasks: [{ worker: true, computer: compId, cwd: '/tmp', task: 'Ship' }] })).exchanges[0].exchangeId
  const remoteChat = `remote:${exId}`
  await work.actFrom(
    'b1',
    { requestId: 'w1', itemId: exId, done: 'Green', level: 3, evidence: [{ proves: 'ok', command: 'echo', output: 'ok' }], status: 'done', result: 'Done' },
    remoteChat
  )
  expect(historyRefs.some(c => c.startsWith('remote:'))).toBe(false)

  board.sendBack(exId, 'Fix edge A')
  answers.tick()
  await until(() => threadStore.pending().some(d => d.kind === 'oscar' && d.threadId === exId))
  expect(hermesRuns).toHaveLength(0)

  await work.actFrom('b1', { requestId: 'w2', itemId: exId, evidence: [{ proves: 'ok2', command: 'echo', output: 'ok2' }], status: 'done', result: 'Done 2' }, remoteChat)
  online = false
  board.sendBack(exId, 'Fix edge B')
  answers.tick()
  await until(() => hermesRuns.length === 1)
  expect(hermesRuns[0].chatId).toBe('src-chat-1')

  answers.queue('int-1', work.store.get(exId)!, 'Stop notice', true)
  answers.tick()
  await until(() => stoppedRemote.length === 1 && hermesRuns.length === 2)
  expect(stoppedRemote).toEqual([remoteChat])
  expect(hermesStops).toEqual([])
  expect(hermesRuns[1].chatId).toBe('src-chat-1')
})

test('PR #235 Medium #3, Medium #5, and Low #6: no synthetic claude fallback, restored capacity accounting, and exact id before name', async () => {
  const { core, rw } = makeEnv()
  const noAgentId = core.addComputer('NoAgent', true, false, 'no-agent-1').id
  const namedLeaderId = core.addComputer('leader', true, true, 'remote-named-leader').id
  expect(await rw.resolveRemoteWorker('b1', { computer: 'leader' })).toBeNull()
  expect((await rw.resolveRemoteWorker('b1', { computer: namedLeaderId, cwd: '/tmp' }))?.computerId).toBe(namedLeaderId)

  expect((await rw.runForBot('b1', 'hi', { runId: 'm3-rem', threadId: 't-r', computer: 'gone', cwd: '/tmp', onChat: () => {} })).failureReason).toBe('computer_removed')
  const noAgent = await rw.runForBot('b1', 'hi', { runId: 'm3-na', threadId: 't-na', computer: noAgentId, cwd: '/tmp', onChat: () => {} })
  expect(noAgent.text).toContain('does not advertise a coding agent')

  const map: Record<string, { worker?: boolean; computer?: string }> = {
    t1: { worker: true, computer: namedLeaderId },
    t2: { worker: true, computer: namedLeaderId },
    t3: { worker: true, computer: namedLeaderId }
  }
  expect(
    canStartDelivery(
      { kind: 'request', threadId: 't1' },
      [],
      id => map[id],
      () => ['t1', 't2']
    )
  ).toBe(true)
  expect(
    canStartDelivery(
      { kind: 'request', threadId: 't3' },
      [],
      id => map[id],
      () => ['t1', 't2']
    )
  ).toBe(false)
  expect(
    canStartDelivery(
      { kind: 'request', threadId: 't3' },
      [{ kind: 'request', threadId: 't1' }],
      id => map[id],
      () => ['t1']
    )
  ).toBe(true)
})
