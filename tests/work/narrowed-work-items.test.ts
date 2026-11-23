import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createWork } from '../../server/app-work'
import { Workspaces } from '../../server/bots/workspaces'
import { GoalStore } from '../../server/goals/goal-store'
import { HistoryStore } from '../../server/history/history-store'
import { LibraryStore } from '../../server/library/library-store'
import { RoutineStore } from '../../server/routines/routine-store'
import { SystemChanges } from '../../server/system/system-changes'
import { workTools } from '../../server/system/tool-work'
import { createWorkerMcp } from '../../server/system/worker-mcp'
import { CallingChats } from '../../server/threads/calling-chats'
import { ThreadStore } from '../../server/threads/thread-store'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { WorkBoard } from '../../server/work/work-board'
import type { WorkInput } from '../../shared/work-schema'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

const cleanups: (() => void)[] = []
afterEach(() => {
  while (cleanups.length) cleanups.pop()!()
})

function wired() {
  const fake = fakeService()
  const threadStore = new ThreadStore(fake.database, (_b, c) => c)
  const calls = new CallingChats(0)
  const created = createWork({
    ...fake,
    bots: fake.service,
    threadStore,
    routineStore: new RoutineStore(fake.database),
    webhookStore: new WebhookStore(fake.database),
    rootOf: (_b, c) => c,
    goalStore: new GoalStore(fake.database),
    libraryStore: new LibraryStore(fake.database),
    workspaces: new Workspaces(fake.root),
    history: new HistoryStore(fake.database),
    calls,
    reviewModel: null,
    publish: () => {}
  })
  const oscarAnswers: string[] = []
  const board = new WorkBoard(created.work, created.answers, {
    oscarAnswer: id => oscarAnswers.push(id),
    dropped: () => async () => {}
  })
  const act = (botId: string, input: WorkInput, chat: string) => {
    calls.saw(botId, chat, 'mcp__lilbot_system__lilbot_work', input, crypto.randomUUID())
    return created.work.act(botId, input)
  }
  const addExchange = (id: string, target: string, chatId: string, capabilities?: ('delegation' | 'computers' | 'memory' | 'shell')[]) => {
    const d = threadStore.accept(
      { id: 'b1', name: 'Bot One' },
      { id: target, name: target === 'b1' ? 'Bot One' : 'Bot Two' },
      { requestId: `req-${id}`, text: 'task', chatId: 'b1-src', newId: id, worker: target === 'b1', capabilities }
    )
    threadStore.attach(d, target, chatId, true)
  }
  cleanups.push(() => rmSync(fake.root, { recursive: true, force: true }))
  return { ...fake, ...created, threadStore, calls, board, oscarAnswers, act, addExchange }
}

test('narrowed exchange sessions follow webhook work-board rules: Oscar checks level >= 2, no tampering with unrelated items, fenced reads, safe answers', async () => {
  const f = wired()
  await f.service.createBot({ name: 'Bot Two', function: 'Helper', instructions: '' })
  await f.service.createBot({ name: 'Bot Three', function: 'Checker', instructions: '' })
  const [b1, b2] = f.store.list()
  f.prefs.setMainChat(b2.id, 'b2-main')

  // Unrelated item Oscar opened in Bot Two's main chat + an agreed goal.
  const oscarItem = await f.act(b2.id, { requestId: 'main-1', title: 'Oscar task', kind: 'file', done: 'Saved' }, 'b2-main')
  f.addExchange('ex-narrow', b2.id, 'ex-narrow-chat', ['delegation'])
  f.links.child(oscarItem.id, { id: 'ex-narrow', owner: { id: b2.id, name: b2.name }, asker: { id: b1.id, name: b1.name }, task: 'Untrusted task' })

  // Narrowed receiver cannot set level, link a goal, drop/report unrelated Oscar item, or parent under Oscar's item.
  await expect(f.act(b2.id, { requestId: 'n1', title: 'X', kind: 'reply', level: 2 }, 'ex-narrow-chat')).rejects.toThrow(/check levels/)
  await expect(f.act(b2.id, { requestId: 'n2', title: 'X', kind: 'reply', goalId: 'g1' }, 'ex-narrow-chat')).rejects.toThrow(/goals/)
  await expect(f.act(b2.id, { requestId: 'n3', itemId: oscarItem.id, status: 'dropped', reason: 'nope' }, 'ex-narrow-chat')).rejects.toThrow(/items this run opened/)
  expect(f.work.store.get(oscarItem.id)?.status).toBe('working')
  expect(() => f.links.parentFor(b2.id, 'ex-narrow-chat', oscarItem.id)).toThrow(/item this run opened/)
  expect(f.links.parentFor(b2.id, 'ex-narrow-chat', 'ex-narrow')).toBe('ex-narrow')

  // Opening a deploy item (default level 2) and marking done routes to Oscar, NEVER a level-2 bot checker.
  const deploy = await f.act(b2.id, { requestId: 'n4', title: 'Run untrusted deploy', kind: 'deploy', done: 'Deployed' }, 'ex-narrow-chat')
  expect(deploy.checkLevel).toBe(3)
  const done = await f.act(
    b2.id,
    { requestId: 'n5', itemId: deploy.id, status: 'done', result: 'Claimed done', evidence: [{ proves: 'Deployed', command: 'echo pwn', output: 'ok' }] },
    'ex-narrow-chat'
  )
  expect(done.status).toBe('needs_oscar')
  expect(done.checks.at(-1)?.by.kind).toBe('oscar')

  // Tool reads fence narrowed exchange items as untrusted data.
  const [, listTool] = workTools({ work: f.work, goals: {} as never } as never)
  const listed = (await listTool.run(b2.id, { itemId: deploy.id })) as { title: string; result: string }
  expect(listed.title).toContain('<webhook-work-item>')
  expect(listed.result).toContain('<webhook-work-item>')

  // Oscar's sendBack routes to main chat fenced and NEVER resumes the narrowed exchange session unrestricted.
  const runs: Array<{ chatId?: string; prompt: string }> = []
  f.engine.runRoutine = async (_bot, prompt, opts) => {
    runs.push({ chatId: opts.chatId, prompt })
    return { status: 'completed', text: 'ok' }
  }
  f.board.sendBack(deploy.id, 'Check manually')
  f.answers.tick()
  await until(() => runs.length > 0)
  expect(runs[0].chatId).toBe('b2-main')
  expect(runs[0].prompt).toContain('<webhook-work-item>')
  expect(runs[0].prompt).toContain('Check manually')
  expect(f.oscarAnswers).toEqual([])
})

test('narrowed remote worker cannot raise level and routes level-2 code checks to Oscar; unrestricted exchanges still use bot checks', async () => {
  const f = wired()
  await f.service.createBot({ name: 'Checker', function: 'Checks', instructions: '' })
  const [b1] = f.store.list()
  f.work.levels.set('code', b1.id, 2)

  // Narrowed remote worker
  f.addExchange('rw-narrow', b1.id, 'remote:rw-narrow', ['delegation', 'computers'])
  f.links.workerChild(null, { id: 'rw-narrow', owner: { id: b1.id, name: b1.name }, task: 'Untrusted code' })
  expect(f.work.store.get('rw-narrow')?.checkLevel).toBe(3)
  const dir = mkdtempSync(join(tmpdir(), 'lilbot-wmcp-'))
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  const tools = workTools({ work: f.work, goals: {} as never } as never)
  const mcp = createWorkerMcp({ store: f.store, work: f.work, changes: new SystemChanges(f.database) }, tools)
  const ctx = { botId: b1.id, computerId: 'c1', threadId: 'rw-narrow', runId: 'r1', chatId: 'remote:rw-narrow' }
  const call = async (args: Record<string, unknown>) =>
    JSON.parse((await mcp(ctx, JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'lilbot_work', arguments: args } }))).body)

  const raise = await call({ requestId: 'rw1', itemId: 'rw-narrow', level: 2, done: 'x' })
  expect(raise.result.isError).toBe(true)
  expect(raise.result.content[0].text).toMatch(/check levels/)

  const finish = await call({
    requestId: 'rw2',
    itemId: 'rw-narrow',
    done: 'Patched',
    status: 'done',
    result: 'Fixed',
    evidence: [{ proves: 'Patched', command: 'bun test', output: 'ok' }]
  })
  expect(finish.result.isError).toBeUndefined()
  const parsed = JSON.parse(finish.result.content[0].text)
  expect(parsed.status).toBe('needs_oscar')
  expect(parsed.title).toContain('<webhook-work-item>')

  // Unrestricted exchange still routes level-2 code checks to a bot checker and stays unfenced.
  f.addExchange('rw-open', b1.id, 'rw-open-chat')
  f.links.workerChild(null, { id: 'rw-open', owner: { id: b1.id, name: b1.name }, task: 'Normal code' })
  expect(f.work.store.get('rw-open')?.checkLevel).toBe(2)
  const openDone = await f.act(
    b1.id,
    { requestId: 'o1', itemId: 'rw-open', done: 'Tests pass', status: 'done', result: 'Done', evidence: [{ proves: 'Tests pass', command: 'bun test', output: 'ok' }] },
    'rw-open-chat'
  )
  expect(openDone.status).toBe('checking')
  expect(openDone.checks.at(-1)?.by.kind).toBe('bot')
  const [, listTool] = tools
  expect(((await listTool.run(b1.id, { itemId: 'rw-open' })) as { title: string }).title).toBe('Normal code')
})
