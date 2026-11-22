import { afterAll, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { threadEvents } from '../../server/http/thread-events'
import { WorkBoard } from '../../server/work/work-board'
import { workFixture } from '../work/work-fixture'
import { delegationFixture, removeFixtureFolders } from './delegation-fixture'

afterAll(removeFixtureFolders)

test('worker continuation, redirect, status lastAnswer, wait, file download, threadEvents and roster all work', async () => {
  const f = delegationFixture()
  mkdirSync(join(f.root, 'a'), { recursive: true })
  writeFileSync(f.path('a', 'spec.txt'), 'implement feature x')
  const started = await f.delegation.delegate('a', { requestId: 'r1', tasks: [{ worker: true, task: 'Build feature X', files: ['spec.txt'] }] })
  const id = started.exchanges[0].exchangeId
  await f.settle()

  // Roster must never show "For A" while A's own worker runs; threadEvents emits 'worker' without throwing.
  expect(f.threads.roster().get('a')?.workingFor).toBeUndefined()
  const pushed: any[] = []
  threadEvents(f.store, { list: () => [{ id: 'a' }] }, { mainChat: () => 'a-main' }, frame => pushed.push(frame))
  expect(pushed.find(p => p.event === 'chat')?.data).toEqual({ type: 'thread', threadId: id, name: 'worker', detail: 'Build feature X' })

  // Sent file downloads cleanly for the same bot.
  const sentMsgId = f.store.get(id).messages[0].id
  const sentFile = await f.threads.file('a', id, sentMsgId, 0)
  expect(Buffer.from(sentFile.data).toString('utf8')).toBe('implement feature x')

  // Redirect mid-run steers the worker and wait registers without throwing.
  const wait = await f.delegation.wait('a', { exchangeIds: [id] })
  expect(wait.allIn).toBe(false)
  const redir = await f.delegation.redirect('a', { requestId: 'red1', exchangeId: id, message: 'Add tests too' })
  expect(redir.applied).toBe('now')
  expect(f.steers[0].text).toContain('worker exchange')

  // Worker attaches a reply file and finishes.
  writeFileSync(f.path('a', 'out.txt'), 'patch summary')
  await f.delegation.attach('a', { exchangeId: id, files: ['out.txt'] })
  f.runs[0].finish('Implemented X with tests.', [{ kind: 'user', text: 'a:red1' }])
  await f.settle()
  await f.settle()

  const status = await f.delegation.status('a', { exchangeIds: [id] })
  expect(status.exchanges[0]).toMatchObject({ exchangeId: id, to: 'worker', worker: true, status: 'finished', lastAnswer: 'Implemented X with tests.' })
  const view = await f.threads.open('a', id)
  const reply = view.messages.find(m => m.fromWorker)!
  expect(reply.fromWorker).toBe(true)
  const backFile = await f.threads.file('a', id, reply.id, 0)
  expect(Buffer.from(backFile.data).toString('utf8')).toBe('patch summary')
  expect(f.runs[1].prompt).toContain('Worker answer from your worker')
  expect(f.runs[1].prompt).toContain(`worker finished (exchange ${id})`)
  f.runs[1].finish('Reported to Oscar.')
  await f.settle()

  // Continue the same worker via exchangeId (no model/effort re-sent).
  await f.delegation.delegate('a', { requestId: 'cont', tasks: [{ exchangeId: id, task: 'Fix one lint warning' }] })
  await f.settle()
  expect(f.runs[2].options.chatId).toBe(f.runs[0].chatId)
  expect(f.runs[2].options.model).toBeUndefined()
  expect(f.runs[2].options.reasoningEffort).toBeUndefined()
})

test('cancelling a running worker withholds late output and keeps status cancelled', async () => {
  const f = delegationFixture()
  const id = (await f.delegation.delegate('a', { requestId: 'c1', tasks: [{ worker: true, task: 'Slow build' }] })).exchanges[0].exchangeId
  await f.settle()
  await f.delegation.cancel('a', id)
  expect(f.stops).toEqual([f.runs[0].chatId])
  f.runs[0].finish('Late answer after stop')
  await f.settle()
  const view = await f.threads.open('a', id)
  expect(view.status).toBe('cancelled')
  expect(view.messages.at(-1)?.withheld).toBe(true)
  expect(view.messages.at(-1)?.fromWorker).toBe(true)
  expect((await f.delegation.status('a', { exchangeIds: [id] })).exchanges[0].lastAnswer).toBeUndefined()
  expect(f.runs).toHaveLength(1)
})

test('every worker opens a code work item (with or without parent), supports needs_oscar answers and drops on cascade', async () => {
  const w = workFixture()
  const d = delegationFixture({
    database: w.database,
    work: w.links,
    changed: () => w.links.settleExchanges(id => d.store.get(id).stoppedBy?.name ?? null)
  })
  const board = new WorkBoard(w.work, w.answers, d.threads)
  // Raise bot a's default check level for code to 2 to confirm floor('code', botId) is respected.
  await board.setLevel({ kind: 'code', botId: 'a', level: 2 })

  // 1. Worker without a parent work item still gets a top-level `code` work item at level 2.
  const soloId = (await d.delegation.delegate('a', { requestId: 'solo', tasks: [{ worker: true, task: 'Fix build script' }] })).exchanges[0].exchangeId
  const soloItem = board.open(soloId)
  expect(soloItem).toMatchObject({ id: soloId, ownerId: 'a', kind: 'code', checkLevel: 2, defaultLevel: 2, parentId: null, status: 'open' })
  expect(soloItem.askedBy).toEqual({ kind: 'self', id: 'a', name: 'A' })

  // Worker asks Oscar a question on its code item -> Oscar's answer delivers back into the worker exchange!
  await d.settle()
  w.state.chats.set('a', d.runs[0].chatId)
  await w.work.act('a', { requestId: 'q1', itemId: soloId, done: 'Build script passes', status: 'needs_oscar', question: 'Keep Node 20?' })
  board.answer(soloId, 'Yes, keep Node 20.')
  expect(board.open(soloId).status).toBe('open')
  d.runs[0].finish('Waiting on Oscar')
  await d.settle()
  await d.settle()
  const oscarTurn = d.runs.find(r => r.prompt.includes('Yes, keep Node 20.'))
  expect(oscarTurn).toBeDefined()
  expect(oscarTurn!.options.chatId).toBe(d.runs[0].chatId)

  // 2. Worker started under a parent work item links as its child and drops when the parent is dropped.
  w.state.chats.set('a', 'a-main')
  const parent = await w.open('a')
  const childId = (await d.delegation.delegate('a', { requestId: 'under', itemId: parent.id, tasks: [{ worker: true, task: 'Implement endpoint' }] })).exchanges[0].exchangeId
  expect(board.open(childId)).toMatchObject({ parentId: parent.id, kind: 'code', checkLevel: 2 })
  await d.settle()
  await board.drop(parent.id, 'Changed priorities')
  expect(board.open(childId).status).toBe('dropped')
  expect(d.store.get(childId).status).toBe('cancelled')
})

test('roster reports worker count/activity without feeding activity.observe, pushes only for sole worker tools, and pushes immediately on cancel', async () => {
  const pushes: boolean[] = []
  const observed: { botId: string; kind: string; working: boolean }[] = []
  const f = delegationFixture({
    touched: roster => roster !== undefined && pushes.push(roster),
    activity: (botId, d, working) => observed.push({ botId, kind: d.kind, working })
  })
  await f.delegation.delegate('a', { requestId: 'w1', tasks: [{ worker: true, task: 'Run tests' }] })
  await f.settle()
  // Same-bot worker work deliveries push roster directly without calling activity.observe (keeping the bot's own reply ahead).
  expect(observed).toEqual([])
  expect(pushes).toEqual([true])
  expect(f.threads.roster().get('a')).toEqual({ workers: { count: 1 } })
  pushes.length = 0
  f.threads.runner.sawTool(f.runs[0].chatId, 'Running commands')
  expect(f.threads.roster().get('a')).toEqual({ workers: { count: 1, activity: 'Running commands' } })
  expect(pushes).toEqual([true])
  // Second concurrent worker switches roster to count-only ("2 workers running") and suppresses redundant roster pushes on tool changes.
  const second = await f.delegation.delegate('a', { requestId: 'w2', tasks: [{ worker: true, task: 'Check lint' }] })
  await f.settle()
  expect(f.threads.roster().get('a')).toEqual({ workers: { count: 2 } })
  pushes.length = 0
  f.threads.runner.sawTool(f.runs[1].chatId, 'Editing files')
  expect(pushes).toEqual([false])
  // Cancelling a running worker drops it from the roster and pushes bots.changed immediately, before its turn unwinds.
  pushes.length = 0
  await f.delegation.cancel('a', second.exchanges[0].exchangeId)
  expect(pushes).toEqual([true])
  expect(f.threads.roster().get('a')).toEqual({ workers: { count: 1, activity: 'Running commands' } })
  // Late tool call on a cancelled worker does not push the roster.
  pushes.length = 0
  f.threads.runner.sawTool(f.runs[1].chatId, 'Reading files')
  expect(pushes).toEqual([false])
  // Finishing the worker delivers its answer back into the main chat, which DOES notify activity.observe.
  f.runs[0].finish('Tests passed')
  f.runs[1].finish('Late after stop')
  await f.settle()
  expect(f.threads.roster().get('a')?.workers).toBeUndefined()
  await f.settle()
  expect(observed.some(o => o.kind === 'answer' && o.working)).toBe(true)
})
