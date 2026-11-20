import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createWork } from '../../server/app-work'
import { Workspaces } from '../../server/bots/workspaces'
import { HistoryStore } from '../../server/history/history-store'
import { LibraryStore } from '../../server/library/library-store'
import { RoutineStore } from '../../server/routines/routine-store'
import { files, safeText } from '../../server/skills/skill-files'
import { CallingChats } from '../../server/threads/calling-chats'
import { ThreadStore } from '../../server/threads/thread-store'
import { WebhookStore } from '../../server/webhooks/webhook-store'
import { WorkBoard } from '../../server/work/work-board'
import type { EventFrame } from '../../shared/protocol'
import { fakeService } from '../helpers/fake-engine'

function wired() {
  const fake = fakeService()
  const frames: EventFrame[] = []
  const history = new HistoryStore(fake.database)
  const calls = new CallingChats(() => 'b1-main', 0)
  const work = createWork({
    ...fake,
    bots: fake.service,
    threadStore: new ThreadStore(fake.database),
    routineStore: new RoutineStore(fake.database),
    webhookStore: new WebhookStore(fake.database),
    rootOf: (_bot, chat) => chat,
    libraryStore: new LibraryStore(fake.database),
    workspaces: new Workspaces(fake.root),
    history,
    calls,
    publish: frame => frames.push(frame)
  })
  const board = new WorkBoard(work.work, work.answers, { oscarAnswer: () => {}, dropped: () => async () => {} })
  return { ...fake, ...work, board, frames, history, calls }
}

test('needs Oscar marks the bot unread and waiting through the activity service, unless he is viewing it', async () => {
  const f = wired()
  const item = await f.work.act('b1', { requestId: 'r1', title: 'Book the room', kind: 'file', done: 'a confirmation email' })
  expect(f.activity.state('b1')).toMatchObject({ unread: false })
  await f.work.act('b1', { requestId: 'r2', itemId: item.id, status: 'needs_oscar', question: 'Tuesday or Wednesday?' })
  expect(f.activity.state('b1')).toMatchObject({ status: 'waiting', unread: true })
  expect(f.frames.filter(frame => frame.event === 'work.changed').length).toBeGreaterThanOrEqual(2)
  f.board.answer(item.id, 'Tuesday')
  expect(f.activity.state('b1').status).not.toBe('waiting')
  f.activity.setUnread('b1', false)
  const closeView = f.activity.view('b1')
  await f.work.act('b1', { requestId: 'r3', itemId: item.id, status: 'needs_oscar', question: 'Which floor?' })
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
  f.calls.saw('b1', 'b1-earlier', 'mcp__lilbot_system__lilbot_work', { requestId: 'r1' })
  const item = await f.work.act('b1', { requestId: 'r1', title: 'Book the room', kind: 'file', done: 'a confirmation email' })
  expect(item.origin).toEqual({ kind: 'conversation', id: 'b1-earlier' })
  const row = f.database.query('SELECT session, item FROM history_items WHERE id = ?').get(`work:${item.id}`) as { session: string; item: string }
  expect(row.session).toBe('b1-earlier')
  expect(JSON.parse(row.item)).toEqual({ kind: 'tool', toolId: `work:${item.id}`, workItemId: item.id, name: 'work item', detail: 'Book the room', running: false })
  await f.work.act('b1', { requestId: 'r2', itemId: item.id, status: 'needs_oscar', question: 'Tuesday or Wednesday?' })
  f.prefs.setMainChat('b1', 'b1-main')
  f.board.answer(item.id, 'Tuesday')
  f.answers.tick()
  await Bun.sleep(5)
  expect(runs).toEqual([{ prompt: expect.stringContaining('Tuesday'), chatId: 'b1-main', hidden: true }])
})

test('a level 2 check runs as a new hidden session of another bot, which shows as working; its session is known as a check', async () => {
  const f = wired()
  await f.service.createBot({ name: 'Checker', function: 'Checks', instructions: '' })
  const runs: { botId: string; chatId?: string; hidden?: boolean; runId: string }[] = []
  f.engine.runRoutine = async (botId, _prompt, options) => {
    runs.push({ botId, chatId: options.chatId, hidden: options.hiddenInput, runId: options.runId })
    options.onChat('check-session')
    return new Promise(() => {})
  }
  const item = await f.work.act('b1', { requestId: 'r1', title: 'Post the update', kind: 'outside', done: 'the post is up' })
  const proof = [{ proves: 'the post is up', url: 'https://example.com/post' }]
  const checking = await f.work.act('b1', { requestId: 'r2', itemId: item.id, status: 'done', result: 'Posted', evidence: proof })
  expect(checking).toMatchObject({ status: 'checking', check: { by: { kind: 'bot', name: 'Checker' } } })
  f.checks.tick()
  await Bun.sleep(5)
  expect(runs).toEqual([{ botId: expect.not.stringMatching(/^b1$/), chatId: undefined, hidden: true, runId: `check-${item.id}:check:1` }])
  expect(f.work.checks.isCheckChat('check-session')).toBe(true)
  expect(f.activity.state(checking.check!.by.id!).status).toBe('working')
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
