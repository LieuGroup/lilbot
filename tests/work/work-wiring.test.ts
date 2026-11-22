import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createWork } from '../../server/app-work'
import { Workspaces } from '../../server/bots/workspaces'
import { GoalStore } from '../../server/goals/goal-store'
import { HistoryStore } from '../../server/history/history-store'
import { LibraryStore } from '../../server/library/library-store'
import { RoutineStore } from '../../server/routines/routine-store'
import { files, safeText } from '../../server/skills/skill-files'
import { CallingChats } from '../../server/threads/calling-chats'
import { ThreadStore } from '../../server/threads/thread-store'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { WorkBoard } from '../../server/work/work-board'
import { CHECK_TOOLSETS } from '../../server/work/work-check-rules'
import type { BotModel } from '../../shared/bot-schema'
import type { EventFrame } from '../../shared/protocol'
import type { WorkInput } from '../../shared/work-schema'
import { fakeService } from '../helpers/fake-engine'
import { until } from '../helpers/until'

function wired(reviewModel: BotModel | null = null) {
  const fake = fakeService()
  const frames: EventFrame[] = []
  const history = new HistoryStore(fake.database)
  const calls = new CallingChats(0)
  const work = createWork({
    ...fake,
    bots: fake.service,
    threadStore: new ThreadStore(fake.database),
    routineStore: new RoutineStore(fake.database),
    webhookStore: new WebhookStore(fake.database),
    rootOf: (_bot, chat) => chat,
    goalStore: new GoalStore(fake.database),
    libraryStore: new LibraryStore(fake.database),
    workspaces: new Workspaces(fake.root),
    history,
    calls,
    reviewModel,
    publish: frame => frames.push(frame)
  })
  const board = new WorkBoard(work.work, work.answers, { oscarAnswer: () => {}, dropped: () => async () => {} })
  /** A `lilbot_work` call, reported starting in `chat` first as the engine does. */
  const act = (botId: string, input: WorkInput, chat = `${botId}-main`) => {
    calls.saw(botId, chat, 'mcp__lilbot_system__lilbot_work', input, crypto.randomUUID())
    return work.work.act(botId, input)
  }
  return { ...fake, ...work, board, frames, history, calls, act }
}

test('needs Oscar marks the bot unread and waiting through the activity service, unless he is viewing it', async () => {
  const f = wired()
  const item = await f.act('b1', { requestId: 'r1', title: 'Book the room', kind: 'file', done: 'a confirmation email' })
  expect(f.activity.state('b1')).toMatchObject({ unread: false })
  await f.act('b1', { requestId: 'r2', itemId: item.id, status: 'needs_oscar', question: 'Tuesday or Wednesday?' })
  expect(f.activity.state('b1')).toMatchObject({ status: 'waiting', unread: true })
  expect(f.frames.filter(frame => frame.event === 'work.changed').length).toBeGreaterThanOrEqual(2)
  f.board.answer(item.id, 'Tuesday')
  expect(f.activity.state('b1').status).not.toBe('waiting')
  f.activity.setUnread('b1', false)
  const closeView = f.activity.view('b1')
  await f.act('b1', { requestId: 'r3', itemId: item.id, status: 'needs_oscar', question: 'Which floor?' })
  expect(f.activity.state('b1')).toMatchObject({ status: 'waiting', unread: false })
  closeView()
})

test('an item opened in a conversation leaves a line there linking to it; Oscar’s answer reaches the main conversation', async () => {
  const f = wired()
  const runs: { prompt: string; chatId?: string; hidden?: boolean }[] = []
  f.engine.runRoutine = async (_botId, prompt, options) => {
    runs.push({ prompt, chatId: options.chatId, hidden: options.hiddenInput })
    return { status: 'completed', text: 'ok' }
  }
  const item = await f.act('b1', { requestId: 'r1', title: 'Book the room', kind: 'file', done: 'a confirmation email' }, 'b1-earlier')
  expect(item.origin).toEqual({ kind: 'conversation', id: 'b1-earlier' })
  const row = f.database.query('SELECT session, item FROM history_items WHERE id = ?').get(`work:${item.id}`) as { session: string; item: string }
  expect(row.session).toBe('b1-earlier')
  expect(JSON.parse(row.item)).toEqual({ kind: 'tool', toolId: `work:${item.id}`, workItemId: item.id, name: 'work item', detail: 'Book the room', running: false })
  await f.act('b1', { requestId: 'r2', itemId: item.id, status: 'needs_oscar', question: 'Tuesday or Wednesday?' })
  f.prefs.setMainChat('b1', 'b1-main')
  f.board.answer(item.id, 'Tuesday')
  f.answers.tick()
  await until(() => runs.length > 0)
  expect(runs).toEqual([{ prompt: expect.stringContaining('Tuesday'), chatId: 'b1-main', hidden: true }])
})

test('a level 2 check runs as a new hidden session of another bot, which shows as working; its session is known as a check', async () => {
  const f = wired()
  await f.service.createBot({ name: 'Checker', function: 'Checks', instructions: '' })
  const runs: { botId: string; chatId?: string; hidden?: boolean; runId: string; toolsets?: string[] }[] = []
  f.engine.runRoutine = async (botId, _prompt, options) => {
    runs.push({ botId, chatId: options.chatId, hidden: options.hiddenInput, runId: options.runId, toolsets: options.toolsets })
    options.onChat('check-session')
    return new Promise(() => {})
  }
  const item = await f.act('b1', { requestId: 'r1', title: 'Post the update', kind: 'outside', done: 'the post is up' })
  const proof = [{ proves: 'the post is up', url: 'https://example.com/post' }]
  const checking = await f.act('b1', { requestId: 'r2', itemId: item.id, status: 'done', result: 'Posted', evidence: proof })
  expect(checking).toMatchObject({ status: 'checking', check: { by: { kind: 'bot', name: 'Checker' } } })
  f.checks.tick()
  await until(() => runs.length > 0)
  expect(runs).toEqual([{ botId: expect.not.stringMatching(/^b1$/), chatId: undefined, hidden: true, runId: `check-${item.id}:check:1`, toolsets: CHECK_TOOLSETS }])
  expect(CHECK_TOOLSETS).not.toContain('memory')
  expect(f.work.checks.isCheckChat('check-session')).toBe(true)
  expect(f.activity.state(checking.check!.by.id!).status).toBe('working')
})

test('with no other bot, the check is a new hidden session of the owner on the review model when it differs from the bot’s own', async () => {
  for (const [reviewModel, expected] of [
    [
      { provider: 'cheap', model: 'small-1' },
      { provider: 'cheap', model: 'small-1' }
    ],
    [null, undefined]
  ] as const) {
    const f = wired(reviewModel)
    const runs: { botId: string; chatId?: string; hidden?: boolean; model?: unknown }[] = []
    f.engine.runRoutine = async (botId, _prompt, options) => {
      runs.push({ botId, chatId: options.chatId, hidden: options.hiddenInput, model: options.model })
      options.onChat('same-bot-session')
      return new Promise(() => {})
    }
    const item = await f.act('b1', { requestId: 'r1', title: 'Post the update', kind: 'outside', done: 'the post is up' })
    const proof = [{ proves: 'the post is up', url: 'https://example.com/post' }]
    const checking = await f.act('b1', { requestId: 'r2', itemId: item.id, status: 'done', result: 'Posted', evidence: proof })
    expect(checking).toMatchObject({ status: 'checking', check: { by: { kind: 'bot', id: 'b1' }, sameBot: true, model: expected ?? null } })
    f.checks.tick()
    await until(() => runs.length > 0)
    expect(runs).toEqual([{ botId: 'native-b1', chatId: undefined, hidden: true, model: expected }])
    expect(f.work.checks.isCheckChat('same-bot-session')).toBe(true)
  }
})

for (const [name, folder] of [
  ['lilbot-work', 'work-skill'],
  ['lilbot-check', 'check-skill']
])
  test(`the ${name} skill ships as a valid skill with nothing the skills library refuses`, () => {
    const path = join(import.meta.dir, '../../server/work', folder)
    const skill = files(path)
    expect(Object.keys(skill)).toEqual(['SKILL.md'])
    safeText(skill['SKILL.md'])
    expect(readFileSync(join(path, 'SKILL.md'), 'utf8')).toStartWith(`---\nname: ${name}\ndescription: `)
  })
