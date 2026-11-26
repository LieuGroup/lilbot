import { expect, test } from 'bun:test'
import { rowLead, rowState } from '../../shared/client/bots/row-state'
import { stopThreadCopy } from '../../shared/client/threads/stop-copy'
import { lineState, lineTitle, stripState } from '../../shared/client/threads/thread-lines'
import type { BotThread } from '../../shared/thread-schema'
import type { WorkSummary } from '../../shared/work-schema'
import { dockCollapsedSummary, dockEntries, dockHeaderSummary, dockItems, dockRowState, dockRowTitle, dockSections } from '../../web/src/threads/dock-items'
import { testBot as bot } from './test-bot'

const MIN = 60_000
const T0 = new Date(2026, 10, 26, 14, 0).getTime()
const cos = { id: 'cos', name: 'Chief of Staff' }
const eng = { id: 'eng', name: 'Engineer' }
const srv = { id: 'srv', name: 'Server Engineer' }

function task(id: string, from: { id: string; name: string }, to: { id: string; name: string }, extra: Partial<BotThread> = {}): BotThread {
  return {
    id,
    participants: [from, to],
    createdAt: T0,
    depth: 1,
    state: 'open',
    messages: [{ id: `m-${id}`, authorId: from.id, authorName: from.name, createdAt: T0, items: [{ kind: 'assistant', text: `Task ${id}` }] }],
    batchId: `batch-${id}`,
    parentId: null,
    status: 'working',
    activity: 'Running commands',
    startedAt: T0,
    endedAt: null,
    stoppedBy: null,
    ...extra
  }
}

function waiting(id: string): WorkSummary {
  return {
    id,
    title: `Task ${id}`,
    ownerId: eng.id,
    ownerName: eng.name,
    askedBy: { kind: 'bot', id: cos.id, name: cos.name },
    origin: { kind: 'exchange', id },
    parentId: null,
    goalId: null,
    kind: 'figure',
    checkLevel: 2,
    defaultLevel: 2,
    check: null,
    status: 'needs_oscar',
    question: 'Same dock or live lines?',
    evidenceCount: 0,
    createdAt: T0,
    updatedAt: T0 + MIN,
    startedAt: T0,
    finishedAt: null
  }
}

const now = T0 + 34 * MIN
const first = task('first', cos, eng, { createdAt: T0 })
const second = task('second', cos, eng, { createdAt: T0 + 22 * MIN, startedAt: T0 + 22 * MIN, activity: 'Using a tool' })

test('the receiver sees the tasks handed to it in its own dock, newest first, with Stop and the title alone', () => {
  const items = dockItems([first, second], eng.id, {}, {}, now)
  expect(items.map(item => [item.thread.id, item.kind, item.received])).toEqual([
    ['second', 'running', true],
    ['first', 'running', true]
  ])
  expect(dockRowTitle(items[0], eng.id, false)).toBe('Task second')
  expect(dockRowState(items[0], eng.id, now).text).toBe('Using a tool · 12 min')
  expect(dockHeaderSummary(items)).toEqual({ icon: 'working', text: '2 running · for Chief of Staff' })
  expect(dockCollapsedSummary(items, eng.id)).toEqual({ icon: 'working', lead: '2 running', detail: 'for Chief of Staff' })
  expect(dockSections(items)).toEqual([{ label: null, items }])
  // A received batch is never grouped under "Handed out N tasks" on the receiver's screen.
  const batch = [task('b1', cos, eng, { batchId: 'one' }), task('b2', cos, eng, { batchId: 'one' })]
  expect(dockEntries(dockItems(batch, eng.id, {}, {}, now), batch, eng.id).every(entry => entry.kind === 'single')).toBe(true)
})

test('tasks from two bots say "for 2 bots", and each row starts its state line with the sender', () => {
  const other = task('other', srv, eng, { createdAt: T0 + 30 * MIN, startedAt: T0 + 30 * MIN })
  const items = dockItems([first, other], eng.id, {}, {}, now)
  expect(dockHeaderSummary(items).text).toBe('2 running · for 2 bots')
  expect(dockRowState(items[0], eng.id, now).text).toBe('Server Engineer · Running commands · 4 min')
  expect(dockRowState(items[1], eng.id, now).text).toBe('Chief of Staff · Running commands · 34 min')
  // One sender: no name on the state line, the header says it.
  expect(dockRowState(dockItems([first], eng.id, {}, {}, now)[0], eng.id, now).text).toBe('Running commands · 34 min')
})

test('both kinds: two labelled groups, received first, each task counted once (build note 1)', () => {
  const handed = task('handed', eng, srv, { createdAt: T0 + 20 * MIN })
  const asked = task('asked', cos, eng, { status: 'finished', endedAt: T0 + 10 * MIN })
  const items = dockItems([first, handed, asked], eng.id, { asked: waiting('asked') }, {}, now)
  expect(items.map(item => item.thread.id)).toEqual(['asked', 'handed', 'first'])
  const sections = dockSections(items)
  expect(sections.map(section => [section.label, section.items.map(item => item.thread.id)])).toEqual([
    ['For Chief of Staff', ['asked', 'first']],
    ['Handed out', ['handed']]
  ])
  expect(dockHeaderSummary(items)).toEqual({ icon: 'waiting', text: '2 for Chief of Staff (1 waiting for you) · 1 handed out' })
  expect(dockCollapsedSummary(items, eng.id)).toEqual({ icon: 'waiting', lead: '2 for Chief of Staff (1 waiting for you)', detail: '1 handed out' })
  // Build note 2: the phone-portrait form keeps the counts and drops whom they are for.
  expect(dockHeaderSummary(items, true)).toEqual({ icon: 'waiting', text: '1 waiting for you · 2 running' })
  expect(dockCollapsedSummary(items, eng.id, true)).toEqual({ icon: 'waiting', lead: '1 waiting for you', detail: '2 running' })
  // Without a waiting task the icon is the spinner (build note 3).
  const running = dockItems([first, handed], eng.id, {}, {}, now)
  expect(dockHeaderSummary(running)).toEqual({ icon: 'working', text: '1 for Chief of Staff · 1 handed out' })
})

test('build note 3: the header leads with what its icon shows', () => {
  const asked = task('asked', cos, eng, { status: 'finished', endedAt: T0 + 10 * MIN })
  const items = dockItems([first, asked], eng.id, { asked: waiting('asked') }, {}, now)
  expect(dockHeaderSummary(items)).toEqual({ icon: 'waiting', text: '1 waiting for you · 1 running · for Chief of Staff' })
  const done = task('done', cos, eng, { status: 'finished', endedAt: now - MIN })
  expect(dockHeaderSummary(dockItems([done], eng.id, {}, {}, now))).toEqual({ icon: 'finished', text: '1 finished · for Chief of Staff' })
})

test('the handing-out bot sees exactly what it saw before: same rows, titles, header and no groups', () => {
  const items = dockItems([first, second], cos.id, {}, {}, now)
  expect(items.every(item => !item.received && item.sender === undefined)).toBe(true)
  expect(dockRowTitle(items[0], cos.id, false)).toBe('Engineer · Task second')
  expect(dockRowState(items[0], cos.id, now).text).toBe('Using a tool · 12 min')
  expect(dockHeaderSummary(items)).toEqual({ icon: 'working', text: '2 running' })
  expect(dockCollapsedSummary(items, cos.id)).toEqual({ icon: 'working', lead: '2 running', detail: 'Engineer' })
  expect(dockHeaderSummary(items, true)).toEqual(dockHeaderSummary(items))
  expect(dockSections(items)).toEqual([{ label: null, items }])
})

test('the conversation line, the opened task strip and the Stop dialog are unchanged on either side', () => {
  expect(lineTitle(first, eng.id)).toBe('From Chief of Staff · Task first')
  expect(lineTitle(first, cos.id)).toBe('Engineer · Task first')
  expect(lineState(first, eng.id, now).text).toBe('Running commands · 34 min')
  expect(stripState(first, now).text).toBe('Working · Running commands · 34 min')
  expect(stopThreadCopy(first)).toEqual({
    what: 'task',
    title: 'Stop this task?',
    subject: 'Task first',
    description: 'Engineer stops working on it now. Chief of Staff is told you stopped it, and what was said so far stays readable. Work a bot already did is not undone.',
    confirmLabel: 'Stop task'
  })
})

test("a same-bot worker never shows in another bot's dock, and exchanges between two other bots never do", () => {
  const worker = task('w', cos, cos, { worker: true })
  const between = task('x', cos, srv)
  expect(dockItems([worker, between], eng.id, {}, {}, now)).toEqual([])
})

test("the roster row counts every task for other bots; one keeps today's words", () => {
  const working = { activity: { status: 'working' as const, text: 'Running commands' } }
  const one = { ...bot('eng', working), workingFor: { threadId: 'a', name: 'Chief of Staff' }, tasksFor: [{ threadId: 'a', botId: 'cos', name: 'Chief of Staff' }] }
  expect(rowState(one).text).toBe('For Chief of Staff · Running commands')
  const two = { ...one, tasksFor: [...one.tasksFor, { threadId: 'b', botId: 'cos', name: 'Chief of Staff' }] }
  expect(rowState(two).text).toBe('For Chief of Staff · 2 tasks')
  const three = { ...two, tasksFor: [...two.tasksFor, { threadId: 'c', botId: 'srv', name: 'Server Engineer' }] }
  expect(rowState(three).text).toBe('For 2 bots · 3 tasks')
  expect(rowState({ ...three, activity: { ...three.activity!, status: 'waiting' } }).text).toBe('Waiting for you')
  // An older server without tasksFor: today's text.
  expect(rowState({ ...bot('eng', working), workingFor: { threadId: 'a', name: 'Chief of Staff' } }).text).toBe('For Chief of Staff · Running commands')
})

test('the count is a tail that never truncates; only the name before it may be cut', () => {
  const working = { activity: { status: 'working' as const, text: 'Running commands' } }
  const task = (threadId: string, botId: string, name: string) => ({ threadId, botId, name })
  const two = { ...bot('eng', working), tasksFor: [task('a', 'cos', 'Chief of Staff'), task('b', 'cos', 'Chief of Staff')] }
  expect(rowState(two)).toMatchObject({ text: 'For Chief of Staff · 2 tasks', tail: ' · 2 tasks' })
  expect(rowLead(rowState(two))).toBe('For Chief of Staff')
  const three = { ...two, tasksFor: [...two.tasksFor, task('c', 'srv', 'Server Engineer')] }
  expect(rowState(three)).toMatchObject({ text: 'For 2 bots · 3 tasks', tail: ' · 3 tasks' })
  expect(rowLead(rowState(three))).toBe('For 2 bots')
  // Every other line has no tail and is cut as a whole, as before.
  const one = { ...bot('eng', working), workingFor: { threadId: 'a', name: 'Chief of Staff' }, tasksFor: [task('a', 'cos', 'Chief of Staff')] }
  expect(rowState(one).tail).toBeUndefined()
  expect(rowLead(rowState(one))).toBe('For Chief of Staff · Running commands')
  expect(rowState({ ...three, activity: { ...three.activity!, status: 'waiting' } }).tail).toBeUndefined()
  expect(rowState(bot('idle', { function: 'Ships builds' })).tail).toBeUndefined()
})
